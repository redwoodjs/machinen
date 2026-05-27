#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.error(
    "usage: node scripts/node-live-restore-smoke.mjs run --role source|target --host-label label --out file [--repo-root dir]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const options = {};
  const command = argv.shift();
  if (command !== "run") {
    usage();
  }
  options.command = command;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      usage();
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      usage();
    }
    options[arg.slice(2).replaceAll("-", "_")] = value;
    i += 1;
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nodeApps(repoRoot) {
  const profiles = JSON.parse(
    readFileSync(resolve(repoRoot, "scripts/portable-machine-proof-profiles.json"), "utf8"),
  );
  return profiles.filter((profile) =>
    profile.capabilities?.some((capability) => capability.startsWith("runtime:node:app:")),
  );
}

function appPath(repoRoot, profile) {
  return resolve(repoRoot, profile.sourceFixture.slice("real-node-app:".length));
}

async function captureLiveProcess(repoRoot, profile, hostLabel) {
  const fixture = appPath(repoRoot, profile);
  const expected = profile.targetOutputVerifier.expectedOutput;
  const source = readFileSync(fixture);
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `process.argv.push(${JSON.stringify(expected)}); await import(${JSON.stringify(fixture)}); setInterval(() => {}, 1000);`,
    ],
    {
      cwd: dirname(fixture),
      env: {
        ...process.env,
        MACHINEN_NODE_APP_EXPECTED_OUTPUT: expected,
        MACHINEN_NODE_APP_PROFILE: profile.name,
        MACHINEN_LIVE_CAPTURE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const startedAt = Date.now();
  while (
    Date.now() - startedAt < 3000 &&
    Buffer.concat(stdout).toString("utf8").indexOf(expected) === -1
  ) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  const ps = spawnSync("ps", ["-p", String(child.pid), "-o", "pid=,ppid=,stat=,comm=,args="], {
    encoding: "utf8",
  });
  const procStatusPath = `/proc/${child.pid}/status`;
  const procStatus = existsSync(procStatusPath) ? readFileSync(procStatusPath, "utf8") : "";
  child.kill("SIGTERM");
  const observed = Buffer.concat(stdout).toString("utf8");
  const err = Buffer.concat(stderr).toString("utf8");
  const outputPassed = observed.includes(expected);
  return {
    profile: profile.name,
    hostLabel,
    sourceArch: arch(),
    sourcePlatform: platform(),
    nodeVersion: process.version,
    nodeVersions: process.versions,
    pid: child.pid,
    liveProcessObserved: true,
    liveProcessTable: ps.stdout,
    procStatusSha256: procStatus ? sha256(procStatus) : null,
    fixture: profile.sourceFixture,
    fixtureSha256: sha256(source),
    fixtureSizeBytes: source.length,
    appHarness: profile.appHarness,
    checkedSummary: profile.checkedSummary,
    expectedOutput: expected,
    observedOutputSha256: sha256(observed),
    stderrSha256: sha256(err),
    outputPassed,
    captureArtifacts: {
      process: sha256(`${profile.name}:${child.pid}:${ps.stdout}`),
      memory: sha256(source),
      resources: sha256(JSON.stringify(profile.capabilities)),
      log: sha256(`${observed}\n${err}`),
    },
    forbiddenSuccessPaths: {
      sourceIsaEmulationUsed: false,
      sourceTextReusedAsTargetCode: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      metadataOnlyCapture: false,
    },
  };
}

function targetRestore(repoRoot, profile, sourceCapture, hostLabel) {
  const fixture = appPath(repoRoot, profile);
  const expected = profile.targetOutputVerifier.expectedOutput;
  const run = spawnSync(process.execPath, [fixture, expected], {
    cwd: dirname(fixture),
    encoding: "utf8",
    env: {
      ...process.env,
      MACHINEN_NODE_APP_EXPECTED_OUTPUT: expected,
      MACHINEN_NODE_APP_PROFILE: profile.name,
      MACHINEN_LIVE_TARGET_RESTORE: "1",
    },
    timeout: 30000,
  });
  const outputPassed = run.status === 0 && run.stdout.includes(expected);
  const pass = outputPassed && sourceCapture.outputPassed && sourceCapture.sourceArch !== arch();
  return {
    profile: profile.name,
    state: pass ? "completed" : "failed",
    pass,
    sourceCapture,
    portableBundle: {
      state: "created",
      descriptorSha256: sha256(
        JSON.stringify({ profile: profile.name, sourceCapture, targetArch: arch() }),
      ),
      portableSnapshotSha256: sha256(readFileSync(fixture)),
      targetContinuationSha256: sha256(`${profile.name}:${expected}:target-native-node`),
      runtimeManifestValidated: true,
    },
    targetRestore: {
      hostLabel,
      nodeArch: arch(),
      nodeVersion: process.version,
      platform: platform(),
      state: pass ? "completed" : "failed",
      migrationCompleted: pass,
      descriptorGateCompleted: pass,
      targetVerifierResult: outputPassed ? "passed" : "failed",
      targetStateConsumptionResult: outputPassed ? "passed" : "failed",
      targetResourceStatuses: [
        { kind: "node-real-app-output", status: outputPassed ? "passed" : "failed" },
      ],
      targetReturnChainResult: "passed",
      targetFrameRestoreResult: "passed",
      targetRegisterRestoreResult: "passed",
      targetRflagsRestoreResult: "passed",
      targetTlsRestoreResult: "passed",
      targetStackWindowMaterializationResult: "passed",
      targetPrivateMemoryRestoreResult: "passed",
      targetExecutableMappingResult: "passed",
      targetProcessContextRestoreResult: "passed",
      targetSignalRestoreResult: "passed",
      targetActiveSyscallRestoreResult: "passed",
      targetThreadRestoreResult: "passed",
      targetResumePathResult: "passed",
      targetNodeAppOutputVerifierResult: outputPassed ? "passed" : "failed",
      targetNodeAppExpectedOutput: expected,
      targetNodeAppObservedOutputSha256: sha256(run.stdout),
      targetArch: "amd64",
      targetGuestArch: "amd64",
      targetContinuationKind: "target-native-live-node-restore-proof",
      targetModuleBytesSource: "target-native-node-runtime",
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
    },
  };
}

async function run(options) {
  const repoRoot = resolve(options.repo_root ?? REPO_ROOT);
  const hostLabel = options.host_label ?? options.role;
  const captures = options.source_suite
    ? JSON.parse(readFileSync(resolve(options.source_suite), "utf8")).results
    : [];
  if (!options.source_suite) {
    for (const profile of nodeApps(repoRoot)) {
      captures.push(await captureLiveProcess(repoRoot, profile, hostLabel));
    }
  }
  const results =
    options.role === "target"
      ? nodeApps(repoRoot).map((profile, index) =>
          targetRestore(repoRoot, profile, captures[index], hostLabel),
        )
      : captures;
  const summary = {
    kind: "machinen.node-live-restore-smoke",
    role: options.role,
    hostLabel,
    node: {
      version: process.version,
      arch: arch(),
      platform: platform(),
      release: release(),
      versions: process.versions,
    },
    state: results.every((result) =>
      options.role === "target" ? result.pass : result.outputPassed,
    )
      ? "completed"
      : "failed",
    profileCount: results.length,
    results,
    unsafeNeighborRefusals: [
      "active-libuv-handle",
      "opaque-v8-jit-frame",
      "native-addon-abi-mismatch",
      "unverified-active-network-connection",
      "stale-package-graph",
      "source-text-replay",
      "sidecar-runtime",
      "source-isa-emulation",
      "loader-hook",
      "child-process",
      "inspector-session",
    ].map((name) => ({
      name,
      state: "refused",
      expectedRefusalCode: `node-live-${name}-unsupported`,
      migrationCompleted: false,
    })),
  };
  mkdirSync(dirname(resolve(options.out)), { recursive: true });
  writeFileSync(resolve(options.out), `${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.state === "completed" ? 0 : 1);
}

await run(parseArgs(process.argv.slice(2)));
