#!/usr/bin/env node
// Reproduce vm.ts's claude bootstrap on the host, in an isolated $HOME,
// and assert that ~/.claude.json ends up with the expected identity slice.
//
// Why this exists: the bootstrap is a shell snippet executed inside the
// guest under `bash -lc`. It has been wrong four times in a row.
// Reproducing it on the host (where bash, jq, and printf behave the same
// way as in the guest) catches the failure mode without a 30-second VM
// boot loop.
//
// Run: node scripts/test-claude-bootstrap.mjs

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// --- Mirror vm.ts's readHostClaudeAccount() ---------------------------
const SLICE_KEYS = [
  "userID",
  "oauthAccount",
  "hasCompletedOnboarding",
  "firstStartTime",
  "anonymousId",
];
function readHostSlice() {
  const path = join(homedir(), ".claude.json");
  const full = JSON.parse(readFileSync(path, "utf8"));
  const slice = {};
  for (const k of SLICE_KEYS) {
    if (k in full) {
      slice[k] = full[k];
    }
  }
  return JSON.stringify(slice);
}

// --- Mirror vm.ts's STAGE_BOOTSTRAP -----------------------------------
// Keep this byte-for-byte in sync with STAGE_BOOTSTRAP in vm.ts. The
// dev-side bits (stty, winsize agent, cd, exec) and the runuser handoff
// run after a uid switch and aren't exercised here.
const BOOTSTRAP = [
  'mkdir -p "$HOME/.claude"',
  'if [ -n "${MACHINEN_CLAUDE_CREDENTIALS:-}" ]; then',
  '  printf "%s" "$MACHINEN_CLAUDE_CREDENTIALS" > "$HOME/.claude/.credentials.json"',
  '  chmod 600 "$HOME/.claude/.credentials.json"',
  "fi",
  'if [ -n "${MACHINEN_CLAUDE_ACCOUNT_JSON:-}" ]; then',
  '  acct="$HOME/.claude.json.machinen-acct"',
  '  merged="$HOME/.claude.json.machinen-merged"',
  '  printf "%s" "$MACHINEN_CLAUDE_ACCOUNT_JSON" > "$acct"',
  '  if [ -e "$HOME/.claude.json" ] && command -v jq >/dev/null 2>&1 && \\',
  '     jq -e . "$HOME/.claude.json" >/dev/null 2>&1; then',
  '    if jq -s ".[0] * .[1]" "$HOME/.claude.json" "$acct" > "$merged" 2>/dev/null && \\',
  '       [ -s "$merged" ]; then',
  '      mv "$merged" "$HOME/.claude.json"',
  "    else",
  '      rm -f "$merged"',
  '      cp "$acct" "$HOME/.claude.json"',
  "    fi",
  "  else",
  '    cp "$acct" "$HOME/.claude.json"',
  "  fi",
  '  rm -f "$acct"',
  '  chmod 600 "$HOME/.claude.json"',
  "fi",
  "unset MACHINEN_CLAUDE_CREDENTIALS MACHINEN_CLAUDE_ACCOUNT_JSON",
  'cat > "$HOME/.bashrc.machinen" <<\\EOF',
  "claude() {",
  '  IS_SANDBOX=1 command claude --dangerously-skip-permissions "$@"',
  "}",
  "EOF",
  'if ! grep -q ".bashrc.machinen" "$HOME/.bashrc" 2>/dev/null; then',
  '  printf "\\n[ -f \\"\\$HOME/.bashrc.machinen\\" ] && . \\"\\$HOME/.bashrc.machinen\\"\\n" >> "$HOME/.bashrc"',
  "fi",
].join("\n");

// --- Run a bootstrap scenario in an isolated $HOME --------------------
function run(scenario) {
  const { name, preexisting } = scenario;
  const home = mkdtempSync(join(tmpdir(), "claude-bootstrap-test-"));
  try {
    writePreexistingAccount(home, preexisting);
    const slice = readHostSlice();
    const result = runBootstrapScenario(home, scenario, slice);
    const paths = scenarioPaths(home);
    const fail = makeFailReporter(name, result, paths.acctPath);

    if (!assertBootstrapBasics(result, paths, fail)) {
      return;
    }
    if (!assertClaudeAlias(home, fail)) {
      return;
    }
    if (!assertAccountJson(scenario, paths.acctPath, slice, fail)) {
      return;
    }
    console.log(`  PASS [${name}]`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function writePreexistingAccount(home, preexisting) {
  if (preexisting !== undefined) {
    writeFileSync(join(home, ".claude.json"), preexisting);
  }
}

function runBootstrapScenario(home, scenario, slice) {
  const args = scenario.useLoginShell ? ["-lc", BOOTSTRAP] : ["-c", BOOTSTRAP];
  const env = bootstrapEnv(home, scenario.accountEnv, slice);
  return spawnSync("bash", args, { env, encoding: "utf8" });
}

function bootstrapEnv(home, accountEnv, slice) {
  const env = {
    ...process.env,
    HOME: home,
    MACHINEN_CLAUDE_CREDENTIALS: '{"fake":"creds"}',
  };
  // accountEnv: undefined → use real slice; null → leave var unset; "" → empty string
  if (accountEnv === undefined) {
    env.MACHINEN_CLAUDE_ACCOUNT_JSON = slice;
  } else if (accountEnv !== null) {
    env.MACHINEN_CLAUDE_ACCOUNT_JSON = accountEnv;
  }
  return env;
}

function scenarioPaths(home) {
  return {
    credsPath: join(home, ".claude", ".credentials.json"),
    acctPath: join(home, ".claude.json"),
    bashrcMachinen: join(home, ".bashrc.machinen"),
    bashrc: join(home, ".bashrc"),
  };
}

function makeFailReporter(name, result, acctPath) {
  return (msg) => {
    console.error(`  FAIL [${name}]: ${msg}`);
    console.error(`    exit=${result.status}`);
    console.error(`    stdout=${JSON.stringify(result.stdout)}`);
    console.error(`    stderr=${JSON.stringify(result.stderr)}`);
    if (existsSync(acctPath)) {
      console.error(`    .claude.json=${readFileSync(acctPath, "utf8").slice(0, 200)}`);
    }
    process.exitCode = 1;
    return false;
  };
}

function assertBootstrapBasics(result, paths, fail) {
  for (const check of basicBootstrapChecks(result, paths)) {
    const message = check();
    if (message) {
      return fail(message);
    }
  }
  return true;
}

function basicBootstrapChecks(result, paths) {
  return [
    () => nonzeroExitMessage(result),
    () => unexpectedStderrMessage(result),
    () => missingFileMessage(paths.credsPath, "credentials file not written"),
    () => wrongCredentialsMessage(paths.credsPath),
    () => missingFileMessage(paths.bashrcMachinen, "~/.bashrc.machinen not written"),
    () =>
      bashrcSourcesMachinen(paths.bashrc) ? null : "~/.bashrc not sourcing ~/.bashrc.machinen",
  ];
}

function nonzeroExitMessage(result) {
  return result.status === 0 ? null : `bash exit ${result.status}`;
}

function unexpectedStderrMessage(result) {
  return result.stderr.trim() ? `unexpected stderr: ${result.stderr}` : null;
}

function missingFileMessage(path, message) {
  return existsSync(path) ? null : message;
}

function wrongCredentialsMessage(credsPath) {
  return readFileSync(credsPath, "utf8") === '{"fake":"creds"}'
    ? null
    : "credentials content wrong";
}

function bashrcSourcesMachinen(bashrc) {
  return existsSync(bashrc) && readFileSync(bashrc, "utf8").includes(".bashrc.machinen");
}

function assertClaudeAlias(home, fail) {
  const fakeBin = join(home, "fakebin");
  const fakeClaude = join(fakeBin, "claude");
  mkdirSync(fakeBin, { recursive: true });
  writeFakeClaude(fakeClaude);
  const aliasOut = runAliasCheck(home, fakeBin).stdout;
  const message = aliasFailureMessage(aliasOut);
  return message ? fail(message) : true;
}

function aliasFailureMessage(aliasOut) {
  for (const check of aliasChecks(aliasOut)) {
    const message = check();
    if (message) {
      return message;
    }
  }
  return null;
}

function aliasChecks(aliasOut) {
  return [
    () =>
      aliasOut.includes("IS_SANDBOX=1")
        ? null
        : `alias didn't set IS_SANDBOX=1; stdout=${aliasOut}`,
    () =>
      aliasOut.includes("arg=--dangerously-skip-permissions")
        ? null
        : `alias didn't pass --dangerously-skip-permissions; stdout=${aliasOut}`,
    () =>
      aliasOut.includes("arg=one") && aliasOut.includes("arg=two")
        ? null
        : `alias didn't forward user args; stdout=${aliasOut}`,
  ];
}

function writeFakeClaude(fakeClaude) {
  writeFileSync(
    fakeClaude,
    '#!/bin/sh\nprintf \'IS_SANDBOX=%s\\n\' "$IS_SANDBOX"\nfor a in "$@"; do printf \'arg=%s\\n\' "$a"; done\n',
  );
  chmodSync(fakeClaude, 0o755);
}

function runAliasCheck(home, fakeBin) {
  return spawnSync("bash", ["-ic", "claude one two"], {
    env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}` },
    encoding: "utf8",
  });
}

function assertAccountJson(scenario, acctPath, slice, fail) {
  const haveAccountEnv = hasAccountEnv(scenario.accountEnv);
  if (shouldLeaveAccountAbsent(scenario, haveAccountEnv)) {
    return assertNoAccountFile(acctPath, fail);
  }
  const parsed = readRequiredAccountFile(acctPath, fail);
  if (!parsed) {
    return false;
  }
  return assertParsedAccountJson(
    parsed,
    expectedAccountSlice(haveAccountEnv, slice),
    scenario,
    fail,
  );
}

function hasAccountEnv(accountEnv) {
  return accountEnv !== null && accountEnv !== "";
}

function shouldLeaveAccountAbsent(scenario, haveAccountEnv) {
  return !haveAccountEnv && scenario.preexisting === undefined;
}

function readRequiredAccountFile(acctPath, fail) {
  if (!existsSync(acctPath)) {
    return fail(".claude.json not written") && null;
  }
  return parseAccountFile(acctPath, fail);
}

function expectedAccountSlice(haveAccountEnv, slice) {
  return haveAccountEnv ? JSON.parse(slice) : {};
}

function assertParsedAccountJson(parsed, expected, scenario, fail) {
  if (!assertExpectedAccountKeys(parsed, expected, hasAccountEnv(scenario.accountEnv), fail)) {
    return false;
  }
  return assertPreexistingKeysPreserved(parsed, expected, scenario.preexisting, fail);
}

function assertNoAccountFile(acctPath, fail) {
  if (existsSync(acctPath)) {
    return fail(".claude.json should not exist when account env is missing");
  }
  return true;
}

function parseAccountFile(acctPath, fail) {
  try {
    return JSON.parse(readFileSync(acctPath, "utf8"));
  } catch (e) {
    return fail(`.claude.json invalid JSON: ${e.message}`) && null;
  }
}

function assertExpectedAccountKeys(parsed, expected, haveAccountEnv, fail) {
  if (!haveAccountEnv) {
    return true;
  }
  for (const k of Object.keys(expected)) {
    if (JSON.stringify(parsed[k]) !== JSON.stringify(expected[k])) {
      return fail(`key ${k} not present/equal in merged .claude.json`);
    }
  }
  return true;
}

function assertPreexistingKeysPreserved(parsed, expected, preexisting, fail) {
  const pre = parsePreexistingAccount(preexisting);
  if (!isObjectRecord(pre)) {
    return true;
  }
  return assertPreservedKeys(parsed, expected, pre, fail);
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object";
}

function assertPreservedKeys(parsed, expected, pre, fail) {
  for (const k of Object.keys(pre)) {
    if (shouldCheckPreexistingKey(k, expected) && !sameJson(parsed[k], pre[k])) {
      return fail(`pre-existing key ${k} clobbered`);
    }
  }
  return true;
}

function shouldCheckPreexistingKey(key, expected) {
  return !(key in expected);
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parsePreexistingAccount(preexisting) {
  if (!preexisting) {
    return null;
  }
  try {
    return JSON.parse(preexisting);
  } catch {
    return null;
  }
}

console.log("scenarios:");
run({ name: "fresh $HOME, plain -c", useLoginShell: false });
run({ name: "fresh $HOME, login -lc", useLoginShell: true });
run({
  name: "pre-existing valid .claude.json (preserves extra keys)",
  preexisting: JSON.stringify({ vmAccumulatedKey: "preserved", userID: "stale" }),
  useLoginShell: false,
});
run({
  name: "pre-existing literal `null` .claude.json (overwrite path)",
  preexisting: "null",
  useLoginShell: false,
});
run({
  name: "pre-existing garbage .claude.json (overwrite path)",
  preexisting: "{not json",
  useLoginShell: false,
});
// THE failure mode the user actually hit: a prior boot already wrote a
// valid slice into ~/.claude.json, but THIS boot's account env is
// missing/empty (e.g. host's ~/.claude.json gone, env stripped, etc.).
// jq -s would slurp the disk file (object) plus an empty $acct (null)
// and explode. The bootstrap must detect empty/missing $MACHINEN_*
// upfront and bail without touching the existing valid file.
run({
  name: "pre-existing valid .claude.json + account env unset (bail, keep disk)",
  preexisting: JSON.stringify({ userID: "kept", oauthAccount: { e: "x" } }),
  accountEnv: null,
  useLoginShell: false,
});
run({
  name: "pre-existing valid .claude.json + account env empty string (bail, keep disk)",
  preexisting: JSON.stringify({ userID: "kept", oauthAccount: { e: "x" } }),
  accountEnv: "",
  useLoginShell: false,
});
run({
  name: "fresh $HOME + no account env (bail, no .claude.json written)",
  accountEnv: null,
  useLoginShell: false,
});

if (process.exitCode) {
  console.error("\nFAIL");
  process.exit(process.exitCode);
}
console.log("\nOK");
