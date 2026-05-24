#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const PROFILE_FILE = join(SCRIPT_DIR, "portable-machine-proof-profiles.json");
const PROFILE_FILE_ENV = "PORTABLE_MACHINE_PROOF_PROFILES";
const SMOKE_SCRIPT = join(SCRIPT_DIR, "smoke/portable-machine-restore.sh");
const DEFAULT_TIMEOUT_MS = 900_000;

const VALUE_OPTIONS = new Map([
  ["--profile", "profile"],
  ["--check-summary", "checkSummary"],
  ["--work-dir", "workDir"],
  ["--work-dir-prefix", "workDirPrefix"],
  ["--arm64-ssh", "arm64Ssh"],
  ["--amd64-ssh", "amd64Ssh"],
  ["--amd64-repo", "amd64Repo"],
  ["--target-image", "targetImage"],
  ["--amd64-vmm", "amd64Vmm"],
  ["--amd64-kernel", "amd64Kernel"],
  ["--amd64-assets-dir", "amd64AssetsDir"],
  ["--amd64-path-prefix", "amd64PathPrefix"],
]);
const FLAG_OPTIONS = new Map([
  ["--list", "list"],
  ["--json", "json"],
  ["--dry-run", "dryRun"],
  ["--keep", "keep"],
]);
const ENV_OPTIONS = [
  ["PORTABLE_ARM64_SSH", "arm64Ssh"],
  ["PORTABLE_AMD64_SSH", "amd64Ssh"],
  ["PORTABLE_AMD64_REPO", "amd64Repo"],
  ["PORTABLE_MACHINE_TARGET_VM_IMAGE", "targetImage"],
  ["PORTABLE_AMD64_VMM", "amd64Vmm"],
  ["PORTABLE_AMD64_KERNEL", "amd64Kernel"],
  ["PORTABLE_AMD64_ASSETS_DIR", "amd64AssetsDir"],
  ["PORTABLE_AMD64_PATH_PREFIX", "amd64PathPrefix"],
];
const GATE_FIELDS = {
  descriptor: [["targetRestore.descriptorGateCompleted", "descriptorGateCompleted", true]],
  verifier: [["targetRestore.targetVerifierResult", "targetVerifierResult", "passed"]],
  "state-consumption": [
    ["targetRestore.targetStateConsumptionResult", "targetStateConsumptionResult", "passed"],
  ],
  "return-chain": [["targetRestore.targetReturnChainResult", "targetReturnChainResult", "passed"]],
  frame: [["targetRestore.targetFrameRestoreResult", "targetFrameRestoreResult", "passed"]],
  registers: [
    ["targetRestore.targetRegisterRestoreResult", "targetRegisterRestoreResult", "passed"],
    ["targetRestore.targetRflagsRestoreResult", "targetRflagsRestoreResult", "passed"],
  ],
  tls: [["targetRestore.targetTlsRestoreResult", "targetTlsRestoreResult", "passed"]],
  "stack-window": [
    [
      "targetRestore.targetStackWindowMaterializationResult",
      "targetStackWindowMaterializationResult",
      "passed",
    ],
  ],
  "private-memory": [
    [
      "targetRestore.targetPrivateMemoryRestoreResult",
      "targetPrivateMemoryRestoreResult",
      "passed",
    ],
  ],
  executable: [
    ["targetRestore.targetExecutableMappingResult", "targetExecutableMappingResult", "passed"],
  ],
  "process-context": [
    [
      "targetRestore.targetProcessContextRestoreResult",
      "targetProcessContextRestoreResult",
      "passed",
    ],
  ],
  signal: [["targetRestore.targetSignalRestoreResult", "targetSignalRestoreResult", "passed"]],
  "active-syscall": [
    [
      "targetRestore.targetActiveSyscallRestoreResult",
      "targetActiveSyscallRestoreResult",
      "passed",
    ],
  ],
  "controlled-thread": [
    ["targetRestore.targetThreadRestoreResult", "targetThreadRestoreResult", "passed"],
  ],
  "resume-path": [["targetRestore.targetResumePathResult", "targetResumePathResult", "passed"]],
};

function profileFile() {
  return process.env[PROFILE_FILE_ENV] ? resolve(process.env[PROFILE_FILE_ENV]) : PROFILE_FILE;
}

function loadProfiles() {
  return JSON.parse(readFileSync(profileFile(), "utf8"));
}

function profileByName(name) {
  const profiles = loadProfiles();
  const profile = profiles.find((entry) => entry.name === name);
  if (!profile) {
    throw new Error(
      `unknown profile ${name}; known profiles: ${profiles.map((entry) => entry.name).join(", ")}`,
    );
  }
  return profile;
}

function usage(exitCode = 2) {
  const profiles = loadProfiles()
    .map((profile) => profile.name)
    .join(", ");
  console.error(
    `usage: node scripts/portable-machine-proof-runner.mjs [options]\n\nOptions:\n  --profile name              Proof profile to run (default: two-thread-ppoll)\n  --list                      List known profiles\n  --check-summary path        Check an existing smoke summary JSON instead of running\n  --json                      Emit machine-readable JSON\n  --dry-run                   Exercise capture/bundle wiring without target execution\n  --keep                      Preserve the smoke work directory\n  --work-dir path             Exact smoke work directory\n  --work-dir-prefix path      Prefix used to create a unique smoke work directory\n  --arm64-ssh host            arm64 source host\n  --amd64-ssh host            amd64 target host\n  --amd64-repo path           remote repo path on amd64 host\n  --target-image path         target VM rootfs/image path\n  --amd64-vmm path            target VMM path\n  --amd64-kernel path         target kernel path\n  --amd64-assets-dir path     target assets directory\n  --amd64-path-prefix path    PATH prefix used on amd64 host\n  --timeout-ms ms             child process timeout (default: ${DEFAULT_TIMEOUT_MS})\n\nKnown profiles: ${profiles}`,
  );
  process.exit(exitCode);
}

function defaultOptions() {
  return {
    profile: "two-thread-ppoll",
    json: false,
    dryRun: false,
    keep: false,
    list: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

function readValue(argv, index) {
  const next = index + 1;
  if (next >= argv.length || argv[next].startsWith("--")) {
    usage();
  }
  return [argv[next], next];
}

function applyValueOption(options, argv, index, key) {
  const [value, next] = readValue(argv, index);
  options[key] = value;
  return next;
}

function applyTimeoutOption(options, argv, index) {
  const [value, next] = readValue(argv, index);
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    usage();
  }
  options.timeoutMs = timeoutMs;
  return next;
}

// fallow-ignore-next-line complexity
function applyArg(options, argv, index) {
  const arg = argv[index];
  if (arg === "--") {
    return index;
  }
  if (arg === "--help" || arg === "-h") {
    usage(0);
  }
  if (arg === "--timeout-ms") {
    return applyTimeoutOption(options, argv, index);
  }
  if (VALUE_OPTIONS.has(arg)) {
    return applyValueOption(options, argv, index, VALUE_OPTIONS.get(arg));
  }
  if (FLAG_OPTIONS.has(arg)) {
    options[FLAG_OPTIONS.get(arg)] = true;
    return index;
  }
  usage();
}

function parseArgs(argv) {
  const options = defaultOptions();
  for (let index = 0; index < argv.length; index += 1) {
    index = applyArg(options, argv, index);
  }
  return options;
}

function makeWorkDir(options) {
  if (options.workDir) {
    return resolve(options.workDir);
  }
  const safeProfile = options.profile.replace(/[^a-z0-9_.-]/gi, "-");
  const prefix = resolve(options.workDirPrefix ?? join(tmpdir(), `machinen-${safeProfile}-proof-`));
  mkdirSync(dirname(prefix), { recursive: true });
  return `${prefix}${Math.random().toString(16).slice(2)}`;
}

function envWithOptions(options, profile) {
  const env = {
    ...process.env,
    PORTABLE_MACHINE_REMOTE_SOURCE_TARGET: profile.remoteSourceTarget,
    PORTABLE_MACHINE_REMOTE_WORK_STAMP: `${profile.name.replace(/[^a-z0-9_.-]/gi, "-")}-${Date.now()}`,
  };
  for (const [envName, optionName] of ENV_OPTIONS) {
    if (options[optionName]) {
      env[envName] = options[optionName];
    }
  }
  return env;
}

function targetFromSummary(summary) {
  return summary?.targetRestore ?? summary ?? {};
}

function checkEquals(checks, label, actual, expected) {
  checks.push({ label, passed: actual === expected, actual, expected });
}

function checkIncludes(checks, label, actual, expected) {
  checks.push({
    label,
    passed: expected.includes(actual),
    actual,
    expected,
  });
}

function checkResources(checks, target) {
  const statuses = Array.isArray(target.targetResourceStatuses)
    ? target.targetResourceStatuses
    : [];
  checks.push({
    label: "targetResourceStatuses",
    passed: statuses.length > 0 && statuses.every((entry) => entry?.status === "passed"),
    actual: statuses,
    expected: "non-empty array with every status=passed",
  });
}

function applyGateCheck(checks, target, gate) {
  if (gate === "resources") {
    checkResources(checks, target);
    return;
  }
  const fields = GATE_FIELDS[gate];
  if (!fields) {
    checks.push({
      label: `profile gate ${gate}`,
      passed: false,
      actual: "unknown gate",
      expected: "known gate",
    });
    return;
  }
  for (const [label, field, expected] of fields) {
    checkEquals(checks, label, target[field], expected);
  }
}

function gateChecksFor(summary, profile) {
  return profile.expectedResult === "refusal"
    ? refusalChecksFor(summary, profile)
    : successChecksFor(summary, profile);
}

// fallow-ignore-next-line complexity
function successChecksFor(summary, profile) {
  const target = targetFromSummary(summary);
  const checks = [];
  checkEquals(checks, "profile expected result", profile.expectedResult, "success");
  checkEquals(checks, "summary.state", summary?.state, "completed");
  if (profile.supportStatus === "graduated-support") {
    checkGraduatedProfileContract(checks, profile, target);
  }
  checkEquals(
    checks,
    "summary.remoteSourceTarget",
    summary?.remoteSourceTarget,
    profile.remoteSourceTarget,
  );
  checkEquals(checks, "targetRestore.state", target.state, "completed");
  checkEquals(checks, "targetRestore.migrationCompleted", target.migrationCompleted, true);
  for (const gate of profile.expectedGates) {
    applyGateCheck(checks, target, gate);
  }
  return checks;
}

function checkGraduatedProfileContract(checks, profile, target) {
  checkEquals(
    checks,
    "graduated profile old refusal code recorded",
    typeof profile.graduatedFromRefusalCode,
    "string",
  );
  checkEquals(
    checks,
    "graduated profile accepted subset recorded",
    typeof profile.acceptedSubset,
    "string",
  );
  checkEquals(
    checks,
    "graduated profile descriptor gate completed before success",
    target.descriptorGateCompleted,
    true,
  );
  checkEquals(
    checks,
    "graduated profile keeps target-native completion gate",
    target.migrationCompleted,
    true,
  );
}

// fallow-ignore-next-line complexity
function refusalChecksFor(summary, profile) {
  const target = targetFromSummary(summary);
  const checks = [];
  checkEquals(checks, "profile expected result", profile.expectedResult, "refusal");
  checkEquals(
    checks,
    "summary.remoteSourceTarget",
    summary?.remoteSourceTarget,
    profile.remoteSourceTarget,
  );
  checkIncludes(
    checks,
    "summary.state",
    summary?.state,
    expectedStates(profile.expectedSummaryState, ["failed", "refused", "skipped"]),
  );
  checkIncludes(
    checks,
    "targetRestore.state",
    target.state ?? "not-run",
    expectedStates(profile.expectedTargetState, ["refused", "failed", "skipped", "not-run"]),
  );
  checkEquals(
    checks,
    "targetRestore.migrationCompleted",
    target.migrationCompleted ?? false,
    profile.expectedMigrationCompleted ?? false,
  );
  checkEquals(
    checks,
    "targetRestore.descriptorGateCompleted",
    target.descriptorGateCompleted ?? false,
    profile.expectedDescriptorGateCompleted ?? false,
  );
  checkEquals(checks, "refusal.code", refusalCodeFromSummary(summary), profile.expectedRefusalCode);
  checkEquals(
    checks,
    "sourceTextReusedAsTargetCode",
    target.sourceTextReusedAsTargetCode ?? summary?.sourceTextReusedAsTargetCode ?? false,
    false,
  );
  checkEquals(
    checks,
    "sourceIsaEmulationUsed",
    target.sourceIsaEmulationUsed ?? summary?.sourceIsaEmulationUsed ?? false,
    false,
  );
  checkEquals(
    checks,
    "sidecarRuntimeUsed",
    target.sidecarRuntimeUsed ?? summary?.sidecarRuntimeUsed ?? false,
    false,
  );
  return checks;
}

function expectedStates(value, fallback) {
  if (Array.isArray(value)) {
    return value;
  }
  return typeof value === "string" ? [value] : fallback;
}

// fallow-ignore-next-line complexity
function refusalCodeFromSummary(summary) {
  const target = targetFromSummary(summary);
  const candidates = [
    summary?.refusal?.code,
    ...(Array.isArray(summary?.refusals) ? summary.refusals.map((refusal) => refusal?.code) : []),
    target?.refusal?.code,
    target?.refusalCode,
    ...(Array.isArray(target?.refusals) ? target.refusals.map((refusal) => refusal?.code) : []),
  ].filter(Boolean);
  if (candidates.length > 0) {
    return candidates[0];
  }
  const haystack = [summary?.failure, target?.failure, target?.message].filter(Boolean).join("\n");
  const profileCode = summary?.expectedRefusalCode ?? target?.expectedRefusalCode;
  return profileCode && haystack.includes(profileCode) ? profileCode : undefined;
}

export function checkPortableMachineProofSummary(summary, profile) {
  const checks = gateChecksFor(summary, profile);
  const failures = checks.filter((check) => !check.passed);
  return { passed: failures.length === 0, checks, failures };
}

function parseSmokeSummary(stdout, workDir) {
  const text = stdout.trim();
  if (text.length > 0) {
    return JSON.parse(text);
  }
  const summaryPath = join(workDir, "summary.json");
  if (existsSync(summaryPath)) {
    return JSON.parse(readFileSync(summaryPath, "utf8"));
  }
  throw new Error("smoke runner did not emit JSON summary");
}

function smokeArgs(options, workDir) {
  const args = [SMOKE_SCRIPT, "--json", "--remote-e2e", "--keep", "--work-dir", workDir];
  if (options.dryRun) {
    args.push("--dry-run");
  }
  return args;
}

function spawnSmoke(options, profile, workDir) {
  const args = smokeArgs(options, workDir);
  const startedAt = Date.now();
  const child = spawnSync("bash", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: envWithOptions(options, profile),
    timeout: options.timeoutMs,
  });
  return { args, child, elapsedMs: Date.now() - startedAt };
}

function smokeFailure(child, parseFailure) {
  if (child.error) {
    return String(child.error);
  }
  if (child.status !== 0) {
    return `smoke runner exited ${child.status}`;
  }
  return parseFailure;
}

function runnerLogs(workDir) {
  return {
    runnerSummary: join(workDir, "proof-runner-summary.json"),
    smokeSummary: join(workDir, "summary.json"),
    targetRestore: join(workDir, "target-restore.json"),
    targetRestoreStderr: join(workDir, "target-restore.stderr"),
    arm64Capture: join(workDir, "arm64-capture.log"),
  };
}

// fallow-ignore-next-line complexity
function runnerState(options, profile, child, gateCheck) {
  if (options.dryRun) {
    return { failed: false, state: "skipped", pass: false };
  }
  const failed =
    profile.expectedResult === "refusal"
      ? child.error || !gateCheck.passed
      : child.status !== 0 || child.error || !gateCheck.passed;
  return {
    failed,
    state: failed ? "failed" : profile.expectedResult === "refusal" ? "refused" : "completed",
    pass: !failed,
  };
}

// fallow-ignore-next-line complexity
function buildRunnerSummary(options, profile, workDir, run, smokeSummary, parseFailure, gateCheck) {
  const state = runnerState(options, profile, run.child, gateCheck);
  return {
    profile: profile.name,
    remoteSourceTarget: profile.remoteSourceTarget,
    state: state.state,
    pass: state.pass,
    dryRun: options.dryRun,
    command: ["bash", ...run.args],
    exitStatus: run.child.status,
    signal: run.child.signal,
    failure: smokeFailure(run.child, parseFailure),
    workDir,
    logs: runnerLogs(workDir),
    timings: [
      {
        name: "portable-machine-proof-runner",
        status: state.failed ? "failed" : options.dryRun ? "skipped" : "ok",
        ms: run.elapsedMs,
        detail: profile.name,
      },
      ...(smokeSummary?.timings ?? []),
    ],
    gateCheck,
    smokeSummary,
  };
}

function readSmokeResult(run, workDir) {
  try {
    return { smokeSummary: parseSmokeSummary(run.child.stdout, workDir), parseFailure: "" };
  } catch (error) {
    const parseFailure = error instanceof Error ? error.message : String(error);
    return { smokeSummary: null, parseFailure };
  }
}

function runProfile(options, profile) {
  const workDir = makeWorkDir(options);
  const run = spawnSmoke(options, profile, workDir);
  const { smokeSummary, parseFailure } = readSmokeResult(run, workDir);
  const gateCheck = smokeSummary
    ? checkPortableMachineProofSummary(smokeSummary, profile)
    : {
        passed: false,
        checks: [],
        failures: [{ label: "smoke summary parse", actual: parseFailure, expected: "valid JSON" }],
      };
  const summary = buildRunnerSummary(
    options,
    profile,
    workDir,
    run,
    smokeSummary,
    parseFailure,
    gateCheck,
  );
  mkdirSync(workDir, { recursive: true });
  writeFileSync(summary.logs.runnerSummary, JSON.stringify(summary, null, 2));
  return summary;
}

function printGateFailures(failures) {
  for (const failure of failures) {
    console.error(
      `  failed: ${failure.label} expected ${JSON.stringify(failure.expected)} got ${JSON.stringify(failure.actual)}`,
    );
  }
}

function printSummary(summary, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  console.log(
    `portable-machine-proof-runner: ${summary.state} profile=${summary.profile} pass=${summary.pass} workDir=${summary.workDir}`,
  );
  if (!summary.pass && !summary.dryRun) {
    printGateFailures(summary.gateCheck.failures);
  }
}

function supportReport(profiles) {
  const counts = profiles.reduce((acc, profile) => {
    const status = profile.supportStatus ?? "unspecified";
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  const graduated = profiles
    .filter((profile) => profile.supportStatus === "graduated-support")
    .map((profile) => ({
      name: profile.name,
      family: profile.unsafeStateFamily,
      acceptedSubset: profile.acceptedSubset,
      graduatedFromRefusalCode: profile.graduatedFromRefusalCode,
      unsafeVariants: profile.unsafeVariants ?? [],
    }));
  const intentionallyRefused = profiles
    .filter(
      (profile) =>
        profile.supportStatus === "intentional-refusal" ||
        profile.supportStatus === "permanent-refusal",
    )
    .map((profile) => ({
      name: profile.name,
      family: profile.unsafeStateFamily,
      expectedRefusalCode: profile.expectedRefusalCode,
      supportStatus: profile.supportStatus,
    }));
  return { counts, graduated, intentionallyRefused };
}

function listProfiles(json) {
  const profiles = loadProfiles();
  const report = supportReport(profiles);
  if (json) {
    process.stdout.write(`${JSON.stringify({ profiles, supportReport: report }, null, 2)}\n`);
    return;
  }
  for (const profile of profiles) {
    const status = profile.supportStatus ?? "unspecified";
    console.log(`${profile.name}\t${status}\t${profile.sourceFixture}\t${profile.description}`);
  }
  console.log(
    `support-report\tgraduated=${report.graduated.length}\tintentionally-refused=${report.intentionallyRefused.length}`,
  );
}

function checkExistingSummary(options, profile) {
  const summary = JSON.parse(readFileSync(options.checkSummary, "utf8"));
  const gateCheck = checkPortableMachineProofSummary(summary, profile);
  return {
    profile: profile.name,
    state: gateCheck.passed
      ? profile.expectedResult === "refusal"
        ? "refused"
        : "completed"
      : "failed",
    pass: gateCheck.passed,
    gateCheck,
  };
}

// fallow-ignore-next-line complexity
function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    listProfiles(options.json);
    return;
  }
  const profile = profileByName(options.profile);
  const summary = options.checkSummary
    ? checkExistingSummary(options, profile)
    : runProfile(options, profile);
  printSummary(summary, options.json);
  process.exit(summary.pass || summary.dryRun ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
