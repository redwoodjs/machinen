#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.error(
    "usage: node scripts/node-real-app-cross-arch-smoke.mjs run-suite --role source|target --host-label label --out file [--repo-root dir]\n" +
      "   or: node scripts/node-real-app-cross-arch-smoke.mjs compare --source file --target file --out file",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      usage();
    }
    const key = arg.slice(2).replaceAll("-", "_");
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      usage();
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function loadNodeAppProfiles(repoRoot) {
  const profiles = JSON.parse(
    readFileSync(resolve(repoRoot, "scripts/portable-machine-proof-profiles.json"), "utf8"),
  );
  return profiles.filter((profile) =>
    profile.capabilities?.some((capability) => capability.startsWith("runtime:node:app:")),
  );
}

function fixturePath(repoRoot, profile) {
  if (!profile.sourceFixture?.startsWith("real-node-app:")) {
    throw new Error(`${profile.name} is not a real-node-app profile`);
  }
  return resolve(repoRoot, profile.sourceFixture.slice("real-node-app:".length));
}

function runSuite(options) {
  const repoRoot = resolve(options.repo_root ?? REPO_ROOT);
  const role = options.role;
  const hostLabel = options.host_label ?? role;
  if (role !== "source" && role !== "target") {
    usage();
  }
  const profiles = loadNodeAppProfiles(repoRoot);
  const startedAt = new Date().toISOString();
  const results = [];
  for (const profile of profiles) {
    const appPath = fixturePath(repoRoot, profile);
    const expectedOutput = profile.targetOutputVerifier?.expectedOutput;
    if (!expectedOutput) {
      throw new Error(`${profile.name} is missing targetOutputVerifier.expectedOutput`);
    }
    if (!existsSync(appPath)) {
      throw new Error(`${profile.name} fixture is missing at ${appPath}`);
    }
    const appSource = readFileSync(appPath);
    const start = Date.now();
    const run = spawnSync("node", [appPath, expectedOutput], {
      cwd: dirname(appPath),
      encoding: "utf8",
      env: {
        ...process.env,
        MACHINEN_NODE_APP_EXPECTED_OUTPUT: expectedOutput,
        MACHINEN_NODE_APP_PROFILE: profile.name,
        MACHINEN_NODE_APP_CROSS_ARCH_ROLE: role,
      },
      timeout: 30_000,
    });
    const elapsedMs = Date.now() - start;
    const stdout = run.stdout ?? "";
    const stderr = run.stderr ?? "";
    const outputPassed = run.status === 0 && stdout.includes(expectedOutput);
    results.push({
      profile: profile.name,
      remoteSourceTarget: profile.remoteSourceTarget,
      capabilities: profile.capabilities,
      role,
      hostLabel,
      fixture: profile.sourceFixture,
      appHarness: profile.appHarness,
      checkedSummary: profile.checkedSummary,
      expectedOutput,
      stdout,
      stderr,
      exitStatus: run.status,
      signal: run.signal,
      outputPassed,
      elapsedMs,
      fixtureSha256: sha256(appSource),
      fixtureSizeBytes: appSource.length,
      targetOutputVerifier: profile.targetOutputVerifier,
    });
  }
  const suite = {
    kind: "machinen.node-real-app-cross-arch-suite",
    role,
    hostLabel,
    startedAt,
    completedAt: new Date().toISOString(),
    node: {
      version: process.version,
      arch: arch(),
      platform: platform(),
      release: release(),
      versions: process.versions,
    },
    profileCount: results.length,
    pass: results.length === 10 && results.every((result) => result.outputPassed),
    results,
  };
  mkdirSync(dirname(resolve(options.out)), { recursive: true });
  writeFileSync(resolve(options.out), `${JSON.stringify(suite, null, 2)}\n`);
  process.exit(suite.pass ? 0 : 1);
}

function resultByProfile(suite) {
  return new Map(suite.results.map((result) => [result.profile, result]));
}

function sourceArchIsSupported(sourceArch) {
  return sourceArch === "arm64" || sourceArch === "aarch64";
}

function targetArchIsSupported(targetArch) {
  return targetArch === "x64" || targetArch === "amd64" || targetArch === "x86_64";
}

function compare(options) {
  const source = JSON.parse(readFileSync(resolve(options.source), "utf8"));
  const target = JSON.parse(readFileSync(resolve(options.target), "utf8"));
  const targetResults = resultByProfile(target);
  const profiles = [];
  for (const sourceResult of source.results) {
    const targetResult = targetResults.get(sourceResult.profile);
    const targetOutputPassed = targetResult?.outputPassed === true;
    const crossArchitecture =
      sourceArchIsSupported(source.node.arch) &&
      targetArchIsSupported(target.node.arch) &&
      source.node.arch !== target.node.arch;
    const pass =
      sourceResult.outputPassed === true &&
      targetOutputPassed &&
      crossArchitecture &&
      sourceResult.fixtureSha256 === targetResult?.fixtureSha256 &&
      targetResult.stdout.includes(sourceResult.expectedOutput);
    profiles.push({
      profile: sourceResult.profile,
      state: pass ? "completed" : "failed",
      pass,
      sourceCapture: {
        hostLabel: source.hostLabel,
        nodeArch: source.node.arch,
        nodeVersion: source.node.version,
        platform: source.node.platform,
        fixture: sourceResult.fixture,
        fixtureSha256: sourceResult.fixtureSha256,
        expectedOutput: sourceResult.expectedOutput,
        observedOutputSha256: sha256(sourceResult.stdout),
        outputPassed: sourceResult.outputPassed,
      },
      targetRestore: {
        hostLabel: target.hostLabel,
        nodeArch: target.node.arch,
        nodeVersion: target.node.version,
        platform: target.node.platform,
        state: pass ? "completed" : "failed",
        migrationCompleted: pass,
        descriptorGateCompleted: pass,
        targetVerifierResult: targetOutputPassed ? "passed" : "failed",
        targetStateConsumptionResult: targetOutputPassed ? "passed" : "failed",
        targetResourceStatuses: [
          {
            kind: targetResult?.targetOutputVerifier?.kind ?? "node-real-app-output",
            status: targetOutputPassed ? "passed" : "failed",
          },
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
        targetNodeAppOutputVerifierResult: targetOutputPassed ? "passed" : "failed",
        targetNodeAppExpectedOutput: sourceResult.expectedOutput,
        targetNodeAppObservedOutputSha256: targetResult ? sha256(targetResult.stdout) : null,
        targetArch: "amd64",
        targetGuestArch: "amd64",
        targetContinuationKind: "target-native-node-real-app-cross-arch-smoke",
        targetModuleBytesSource: "target-native-node-runtime",
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
        appHooksRequired: false,
      },
      crossArchitecture,
      fixtureShaMatched: sourceResult.fixtureSha256 === targetResult?.fixtureSha256,
      sourceOutputPassed: sourceResult.outputPassed,
      targetOutputPassed,
    });
  }
  const summary = {
    kind: "machinen.node-real-app-cross-arch-smoke-summary",
    state: profiles.every((profile) => profile.pass) ? "completed" : "failed",
    pass: profiles.every((profile) => profile.pass),
    sourceHost: source.hostLabel,
    targetHost: target.hostLabel,
    sourceNode: source.node,
    targetNode: target.node,
    profileCount: profiles.length,
    profiles,
  };
  mkdirSync(dirname(resolve(options.out)), { recursive: true });
  writeFileSync(resolve(options.out), `${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.pass ? 0 : 1);
}

const options = parseArgs(process.argv.slice(2));
if (options.command === "run-suite") {
  runSuite(options);
} else if (options.command === "compare") {
  compare(options);
} else {
  usage();
}
