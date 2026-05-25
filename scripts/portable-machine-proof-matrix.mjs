#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePortableMachineProofProfiles } from "./portable-machine-proof-runner.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const PROFILE_FILE = join(SCRIPT_DIR, "portable-machine-proof-profiles.json");
const RUNNER = join(SCRIPT_DIR, "portable-machine-proof-runner.mjs");
const DEFAULT_TIMEOUT_MS = 900_000;

const PRESETS = {
  "baseline-success": (profiles) =>
    profiles.filter((profile) => profile.supportStatus === "baseline-success"),
  "graduated-support": (profiles) =>
    profiles.filter((profile) => profile.supportStatus === "graduated-support"),
  positive: (profiles) => profiles.filter((profile) => profile.expectedResult === "success"),
  "all-positive": (profiles) => profiles.filter((profile) => profile.expectedResult === "success"),
  refusal: (profiles) => profiles.filter((profile) => profile.expectedResult === "refusal"),
  "refusal-matrix": (profiles) =>
    profiles.filter((profile) => profile.expectedResult === "refusal"),
  "foundation-full": (profiles) => profiles,
  "goal-6-7-full-foundation": (profiles) => profiles,
};

const PASS_THROUGH_OPTIONS = new Set([
  "--arm64-ssh",
  "--amd64-ssh",
  "--amd64-repo",
  "--target-image",
  "--amd64-vmm",
  "--amd64-kernel",
  "--amd64-assets-dir",
  "--amd64-path-prefix",
]);

function usage(exitCode = 2) {
  console.error(
    `usage: node scripts/portable-machine-proof-matrix.mjs [options]\n\nOptions:\n  --preset name               baseline-success, graduated-support, positive, refusal, foundation-full\n  --support-status status     Select profiles by supportStatus (repeatable or comma-separated)\n  --capability capability     Select profiles by capabilities/refusesCapabilities\n  --unsafe-family family      Select profiles by unsafeStateFamily\n  --profile name              Explicit profile (repeatable or comma-separated)\n  --check-summary-dir path    Verify existing <profile>.json summaries instead of running profiles\n  --summary path              Write summary JSON to path\n  --json                      Emit summary JSON to stdout\n  --dry-run                   Pass --dry-run to the underlying proof runner\n  --continue-on-fail          Run all selected profiles after a failure\n  --work-dir-prefix path      Prefix for profile work directories\n  --timeout-ms ms             Per-profile timeout (default: ${DEFAULT_TIMEOUT_MS})`,
  );
  process.exit(exitCode);
}

function readValue(argv, index) {
  const nextIndex = index + 1;
  const value = argv.at(nextIndex);
  if (value === undefined || value.slice(0, 2) === "--") {
    usage();
  }
  return [value, nextIndex];
}

function pushCsv(target, value) {
  const values = value.split(",");
  for (const raw of values) {
    const item = raw.trim();
    if (item.length > 0) {
      target.push(item);
    }
  }
}

function parseArgs(argv) {
  const options = {
    presets: [],
    supportStatuses: [],
    capabilities: [],
    unsafeFamilies: [],
    profiles: [],
    runnerOptions: [],
    json: false,
    dryRun: false,
    continueOnFail: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage(0);
    }
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--continue-on-fail") {
      options.continueOnFail = true;
    } else if (arg === "--preset") {
      const [value, next] = readValue(argv, index);
      pushCsv(options.presets, value);
      index = next;
    } else if (arg === "--support-status") {
      const [value, next] = readValue(argv, index);
      pushCsv(options.supportStatuses, value);
      index = next;
    } else if (arg === "--capability") {
      const [value, next] = readValue(argv, index);
      pushCsv(options.capabilities, value);
      index = next;
    } else if (arg === "--unsafe-family") {
      const [value, next] = readValue(argv, index);
      pushCsv(options.unsafeFamilies, value);
      index = next;
    } else if (arg === "--profile") {
      const [value, next] = readValue(argv, index);
      pushCsv(options.profiles, value);
      index = next;
    } else if (arg === "--summary") {
      [options.summary, index] = readValue(argv, index);
    } else if (arg === "--check-summary-dir") {
      [options.checkSummaryDir, index] = readValue(argv, index);
    } else if (arg === "--work-dir-prefix") {
      [options.workDirPrefix, index] = readValue(argv, index);
    } else if (arg === "--timeout-ms") {
      const [value, next] = readValue(argv, index);
      options.timeoutMs = Number(value);
      index = next;
    } else if (PASS_THROUGH_OPTIONS.has(arg)) {
      const [value, next] = readValue(argv, index);
      options.runnerOptions.push(arg, value);
      index = next;
    } else {
      usage();
    }
  }
  return options;
}

function loadProfiles() {
  return JSON.parse(
    readFileSync(process.env.PORTABLE_MACHINE_PROOF_PROFILES ?? PROFILE_FILE, "utf8"),
  );
}

function uniqProfiles(profiles) {
  const seen = new Set();
  return profiles.filter((profile) => {
    if (seen.has(profile.name)) {
      return false;
    }
    seen.add(profile.name);
    return true;
  });
}

function selectProfiles(profiles, options) {
  const selected = [];
  for (const preset of options.presets) {
    const select = PRESETS[preset];
    if (!select) {
      throw new Error(`unknown matrix preset ${preset}`);
    }
    selected.push(...select(profiles));
  }
  if (options.supportStatuses.length > 0) {
    selected.push(
      ...profiles.filter((profile) => options.supportStatuses.includes(profile.supportStatus)),
    );
  }
  if (options.capabilities.length > 0) {
    selected.push(
      ...profiles.filter((profile) => {
        const caps = [...(profile.capabilities ?? []), ...(profile.refusesCapabilities ?? [])];
        return options.capabilities.some((capability) => caps.includes(capability));
      }),
    );
  }
  if (options.unsafeFamilies.length > 0) {
    selected.push(
      ...profiles.filter((profile) => options.unsafeFamilies.includes(profile.unsafeStateFamily)),
    );
  }
  if (options.profiles.length > 0) {
    for (const name of options.profiles) {
      const profile = profiles.find((candidate) => candidate.name === name);
      if (!profile) {
        throw new Error(`unknown profile ${name}`);
      }
      selected.push(profile);
    }
  }
  return uniqProfiles(selected.length > 0 ? selected : PRESETS["foundation-full"](profiles));
}

function runnerArgs(profile, options, index) {
  const args = [
    RUNNER,
    "--profile",
    profile.name,
    "--json",
    "--timeout-ms",
    String(options.timeoutMs),
  ];
  if (options.dryRun) {
    args.push("--dry-run");
  }
  if (options.checkSummaryDir) {
    args.push("--check-summary", join(resolve(options.checkSummaryDir), `${profile.name}.json`));
  }
  const prefix = options.workDirPrefix ?? join(tmpdir(), "machinen-proof-matrix-");
  args.push("--work-dir-prefix", `${resolve(prefix)}${index}-${profile.name}-`);
  args.push(...options.runnerOptions);
  return args;
}

function runOne(profile, options, index) {
  const startedAt = Date.now();
  const args = runnerArgs(profile, options, index);
  const child = spawnSync("node", args, {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    timeout: options.timeoutMs + 30_000,
  });
  let summary;
  try {
    summary = JSON.parse(child.stdout);
  } catch (error) {
    summary = {
      profile: profile.name,
      state: "failed",
      pass: false,
      failure: error instanceof Error ? error.message : String(error),
      stdout: child.stdout,
      stderr: child.stderr,
    };
  }
  return {
    profile: profile.name,
    supportStatus: profile.supportStatus,
    expectedResult: profile.expectedResult,
    pass: child.status === 0 && summary.pass === true,
    state: summary.state ?? "failed",
    exitStatus: child.status,
    elapsedMs: Date.now() - startedAt,
    workDir: summary.workDir,
    refusalCode: refusalCode(summary),
    targetGates: targetGates(summary),
    remoteHostDetails: summary.proofProvenance?.remote ?? {},
    runnerSummary: summary,
  };
}

function refusalCode(summary) {
  return (
    summary.smokeSummary?.targetRestore?.refusal?.code ??
    summary.gateCheck?.checks?.find((check) => check.label === "refusal.code")?.actual
  );
}

function targetGates(summary) {
  const target = summary.smokeSummary?.targetRestore ?? {};
  return {
    migrationCompleted: target.migrationCompleted,
    descriptorGateCompleted: target.descriptorGateCompleted,
    targetVerifierResult: target.targetVerifierResult,
    targetStateConsumptionResult: target.targetStateConsumptionResult,
    targetResumePathResult: target.targetResumePathResult,
  };
}

function profileCounts(profiles) {
  return profiles.reduce(
    (acc, profile) => {
      acc.total += 1;
      acc.bySupportStatus[profile.supportStatus] =
        (acc.bySupportStatus[profile.supportStatus] ?? 0) + 1;
      acc.byExpectedResult[profile.expectedResult] =
        (acc.byExpectedResult[profile.expectedResult] ?? 0) + 1;
      return acc;
    },
    { total: 0, bySupportStatus: {}, byExpectedResult: {} },
  );
}

function matrixSummary(options, profiles, results, startedAt, schemaValidation) {
  const failed = results.filter((result) => !result.pass);
  return {
    kind: "machinen.portable-machine-proof-matrix",
    state: failed.length === 0 ? "completed" : "failed",
    pass: failed.length === 0,
    profileCounts: profileCounts(profiles),
    selectedProfiles: profiles.map((profile) => profile.name),
    schemaValidation,
    timings: [
      {
        name: "portable-machine-proof-matrix",
        status: failed.length === 0 ? "ok" : "failed",
        ms: Date.now() - startedAt,
      },
      ...results.map((result) => ({
        name: result.profile,
        status: result.pass ? "ok" : "failed",
        ms: result.elapsedMs,
      })),
    ],
    workdirs: Object.fromEntries(
      results.map((result) => [result.profile, result.workDir]).filter((entry) => entry[1]),
    ),
    refusalCodes: Object.fromEntries(
      results.map((result) => [result.profile, result.refusalCode]).filter((entry) => entry[1]),
    ),
    targetGates: Object.fromEntries(results.map((result) => [result.profile, result.targetGates])),
    remoteHostDetails:
      results.find((result) => Object.keys(result.remoteHostDetails).length > 0)
        ?.remoteHostDetails ?? {},
    results,
  };
}

function main() {
  const startedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));
  const allProfiles = loadProfiles();
  const schemaValidation = validatePortableMachineProofProfiles(allProfiles);
  if (!schemaValidation.passed) {
    const summary = matrixSummary(options, [], [], startedAt, schemaValidation);
    output(summary, options);
    process.exit(1);
  }
  const selected = selectProfiles(allProfiles, options);
  const results = [];
  for (const [index, profile] of selected.entries()) {
    const result = runOne(profile, options, index);
    results.push(result);
    if (!result.pass && !options.continueOnFail) {
      break;
    }
  }
  const summary = matrixSummary(options, selected, results, startedAt, schemaValidation);
  output(summary, options);
  process.exit(summary.pass ? 0 : 1);
}

function output(summary, options) {
  if (options.summary) {
    mkdirSync(dirname(resolve(options.summary)), { recursive: true });
    writeFileSync(resolve(options.summary), JSON.stringify(summary, null, 2));
  }
  if (options.json || !options.summary) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
