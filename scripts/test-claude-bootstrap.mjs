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

// --- Mirror vm.ts's bootstrap (minus `exec bash -i`) ------------------
// Keep this byte-for-byte in sync with the bootstrap in vm.ts. The only
// change is dropping the final `exec bash -i` so the test process exits.
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
function run({ name, preexisting, useLoginShell, accountEnv }) {
  const home = mkdtempSync(join(tmpdir(), "claude-bootstrap-test-"));
  try {
    if (preexisting !== undefined) {
      writeFileSync(join(home, ".claude.json"), preexisting);
    }
    const slice = readHostSlice();
    const args = useLoginShell ? ["-lc", BOOTSTRAP] : ["-c", BOOTSTRAP];
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
    const result = spawnSync("bash", args, { env, encoding: "utf8" });
    const credsPath = join(home, ".claude", ".credentials.json");
    const acctPath = join(home, ".claude.json");

    const fail = (msg) => {
      console.error(`  FAIL [${name}]: ${msg}`);
      console.error(`    exit=${result.status}`);
      console.error(`    stdout=${JSON.stringify(result.stdout)}`);
      console.error(`    stderr=${JSON.stringify(result.stderr)}`);
      if (existsSync(acctPath)) {
        console.error(`    .claude.json=${readFileSync(acctPath, "utf8").slice(0, 200)}`);
      }
      process.exitCode = 1;
    };

    if (result.status !== 0) {
      return fail(`bash exit ${result.status}`);
    }
    if (result.stderr.trim()) {
      return fail(`unexpected stderr: ${result.stderr}`);
    }
    if (!existsSync(credsPath)) {
      return fail("credentials file not written");
    }
    if (readFileSync(credsPath, "utf8") !== '{"fake":"creds"}') {
      return fail("credentials content wrong");
    }
    // Alias: ~/.bashrc.machinen written; ~/.bashrc sources it; calling
    // `claude` from `bash -i` injects IS_SANDBOX=1 +
    // --dangerously-skip-permissions and forwards user args. Verified
    // for every scenario, regardless of account-env state.
    const bashrcMachinen = join(home, ".bashrc.machinen");
    if (!existsSync(bashrcMachinen)) {
      return fail("~/.bashrc.machinen not written");
    }
    const bashrc = join(home, ".bashrc");
    if (!existsSync(bashrc) || !readFileSync(bashrc, "utf8").includes(".bashrc.machinen")) {
      return fail("~/.bashrc not sourcing ~/.bashrc.machinen");
    }
    const fakeBin = join(home, "fakebin");
    const fakeClaude = join(fakeBin, "claude");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      fakeClaude,
      '#!/bin/sh\nprintf \'IS_SANDBOX=%s\\n\' "$IS_SANDBOX"\nfor a in "$@"; do printf \'arg=%s\\n\' "$a"; done\n',
    );
    chmodSync(fakeClaude, 0o755);
    const aliasCheck = spawnSync("bash", ["-ic", "claude one two"], {
      env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    const aliasOut = aliasCheck.stdout;
    if (!aliasOut.includes("IS_SANDBOX=1")) {
      return fail(`alias didn't set IS_SANDBOX=1; stdout=${aliasOut}`);
    }
    if (!aliasOut.includes("arg=--dangerously-skip-permissions")) {
      return fail(`alias didn't pass --dangerously-skip-permissions; stdout=${aliasOut}`);
    }
    if (!aliasOut.includes("arg=one") || !aliasOut.includes("arg=two")) {
      return fail(`alias didn't forward user args; stdout=${aliasOut}`);
    }
    const haveAccountEnv = accountEnv !== null && accountEnv !== "";
    if (!haveAccountEnv && preexisting === undefined) {
      // No account env, no prior file. Bootstrap should have left
      // .claude.json absent — credentials still go through.
      if (existsSync(acctPath)) {
        return fail(".claude.json should not exist when account env is missing");
      }
      console.log(`  PASS [${name}]`);
      return;
    }
    if (!existsSync(acctPath)) {
      return fail(".claude.json not written");
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(acctPath, "utf8"));
    } catch (e) {
      return fail(`.claude.json invalid JSON: ${e.message}`);
    }
    const expected = haveAccountEnv ? JSON.parse(slice) : {};
    if (haveAccountEnv) {
      for (const k of Object.keys(expected)) {
        if (JSON.stringify(parsed[k]) !== JSON.stringify(expected[k])) {
          return fail(`key ${k} not present/equal in merged .claude.json`);
        }
      }
    }
    if (preexisting) {
      let pre;
      try {
        pre = JSON.parse(preexisting);
      } catch {
        pre = null;
      }
      if (pre && typeof pre === "object") {
        for (const k of Object.keys(pre)) {
          if (k in expected) {
            continue;
          }
          if (JSON.stringify(parsed[k]) !== JSON.stringify(pre[k])) {
            return fail(`pre-existing key ${k} clobbered`);
          }
        }
      }
    }
    console.log(`  PASS [${name}]`);
  } finally {
    rmSync(home, { recursive: true, force: true });
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
