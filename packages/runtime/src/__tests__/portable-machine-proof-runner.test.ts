import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const RUNNER = join(REPO_ROOT, "scripts/portable-machine-proof-runner.mjs");
const NODE_CROSS_ARCH_SMOKE = join(REPO_ROOT, "scripts/node-real-app-cross-arch-smoke.mjs");
const NODE_LIVE_RESTORE_SMOKE = join(REPO_ROOT, "scripts/node-live-restore-smoke.mjs");
const NODE_PRODUCTION_RESTORE_PROOF = join(REPO_ROOT, "scripts/node-production-restore-proof.mjs");
const NODE_EXPANDED_RESTORE_PROOF = join(REPO_ROOT, "scripts/node-expanded-restore-proof.mjs");
const NODE_COMPLEX_RESTORE_PROOF = join(REPO_ROOT, "scripts/node-complex-restore-proof.mjs");
const NODE_ECOSYSTEM_RESTORE_PROOF = join(REPO_ROOT, "scripts/node-ecosystem-restore-proof.mjs");
const NON_NODE_RUNTIME_PROOF = join(REPO_ROOT, "scripts/non-node-runtime-proof.mjs");
const PROOF_MATRIX = join(REPO_ROOT, "scripts/portable-machine-proof-matrix.mjs");
const SCRIPT_ENV = { ...process.env, FORCE_COLOR: "1" };
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portable-machine-proof-runner-"));
  tempDirs.push(dir);
  return dir;
}

function completedSummary(remoteSourceTarget = "file-write") {
  const targetRestore = {
    state: "completed",
    migrationCompleted: true,
    descriptorGateCompleted: true,
    targetVerifierResult: "passed",
    targetStateConsumptionResult: "passed",
    targetResourceStatuses: [{ kind: "reopen-file", status: "passed" }],
    targetReturnChainResult: "passed",
    targetFrameRestoreResult: "passed",
    targetRegisterRestoreResult: "passed",
    targetRflagsRestoreResult: "passed",
    targetTlsRestoreResult: "passed",
    targetStackWindowMaterializationResult: "passed",
    targetPrivateMemoryRestoreResult: "passed",
    targetExecutableMappingResult: "passed",
    targetSignalRestoreResult: "passed",
    targetResumePathResult: "passed",
  };
  if (remoteSourceTarget === "process-context") {
    return {
      profile: "portable-machine-restore",
      state: "completed",
      remoteSourceTarget,
      targetRestore: { ...targetRestore, targetProcessContextRestoreResult: "passed" },
      timings: [],
    };
  }
  return {
    profile: "portable-machine-restore",
    state: "completed",
    remoteSourceTarget,
    targetRestore: { ...targetRestore, targetActiveSyscallRestoreResult: "passed" },
    timings: [],
  };
}

function refusedSummary(
  remoteSourceTarget = "socket-transfer-refusal",
  code = "target-socket-syscall-state-unsupported",
) {
  return {
    profile: "portable-machine-restore",
    state: "failed",
    failure: `target restore refused with ${code}`,
    remoteSourceTarget,
    targetRestore: {
      state: "refused",
      migrationCompleted: false,
      descriptorGateCompleted: false,
      refusal: {
        code,
        message: `${remoteSourceTarget} is unsupported`,
      },
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    },
    timings: [],
  };
}

const negativeProfiles = [
  ["readiness-wait-refusal", "kernel-state-unsupported"],
  ["readiness-scheduler-refusal", "kernel-state-unsupported"],
  ["readiness-edge-trigger-refusal", "kernel-state-unsupported"],
  ["readiness-signal-mask-refusal", "signal-state-unsupported"],
  ["readiness-pollfd-memory-refusal", "mapping-provenance-ambiguous"],
  ["socket-readiness-refusal", "target-socket-syscall-state-unsupported"],
  ["auxv-source-pointer-refusal", "target-process-context-unsupported"],
  ["at-random-source-refusal", "target-process-context-unsupported"],
  ["at-execfn-identity-refusal", "target-process-context-unsupported"],
  ["target-libc-global-refusal", "target-process-context-unsupported"],
  ["argv-env-pointer-refusal", "target-process-context-unsupported"],
  ["private-layout-refusal", "mapping-permission-unsupported"],
  ["shared-mapping-refusal", "mapping-shared-unsupported"],
  ["private-source-pointer-refusal", "mapping-provenance-ambiguous"],
  ["stale-private-range-refusal", "mapping-captured-range-unsupported"],
  ["wx-private-mapping-refusal", "mapping-executable-unsupported"],
  ["signal-mask-restart-refusal", "signal-state-unsupported"],
  ["pending-signal-refusal", "signal-state-unsupported"],
  ["active-signal-frame-refusal", "signal-state-unsupported"],
  ["alt-stack-refusal", "signal-state-unsupported"],
  ["restart-remaining-time-refusal", "syscall-restart-unsupported"],
  ["socket-transfer-refusal", "target-socket-syscall-state-unsupported"],
  ["epoll-wait-refusal", "target-epoll-syscall-state-unsupported"],
  ["signalfd-read-refusal", "target-signalfd-state-unsupported"],
  ["futex-refusal", "futex-state-unsupported"],
  ["rseq-refusal", "rseq-state-unsupported"],
  ["restart-state-refusal", "syscall-restart-unsupported"],
  ["jit-self-modifying-refusal", "mapping-executable-unsupported"],
  ["source-vdso-vvar-refusal", "vdso-policy-unsupported"],
  ["raw-cross-isa-vmstate-refusal", "cross-isa-vmstate-restore-unsupported"],
  ["descriptor-provenance-refusal", "mapping-provenance-ambiguous"],
  ["duplicate-fd-alias-refusal", "target-fd-table-duplicate"],
  ["fd-alias-lock-refusal", "target-fd-table-duplicate"],
  ["fd-alias-socket-refusal", "target-socket-syscall-state-unsupported"],
  ["fd-alias-epoll-cycle-refusal", "target-epoll-syscall-state-unsupported"],
] as const;

describe("portable machine proof runner", () => {
  it("lists every current remote proof profile", () => {
    const result = spawnSync("node", [RUNNER, "--list", "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: SCRIPT_ENV,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    const names = summary.profiles.map((profile: { name: string }) => profile.name);
    expect(names.slice(0, 5)).toEqual([
      "two-thread-ppoll",
      "pipe-read",
      "eventfd-read",
      "eventfd-counter-recreate",
      "eventfd-alias-counter-recreate",
    ]);
    expect(names).toEqual(
      expect.arrayContaining([
        "epoll-recreate",
        "timerfd-descriptor-recreate",
        "pipe-pair-recreate",
        "signalfd-recreate",
        "eventfd-alias-counter-recreate",
        "eventfd-readiness-pollin-recreate",
        "regular-file-duplicate-fd-recreate",
        "target-auxv-at-random",
        "private-anonymous-data-range-recreate",
        "signal-mask-blocked-recreate",
        "readiness-wait-refusal",
        "readiness-scheduler-refusal",
        "readiness-edge-trigger-refusal",
        "readiness-signal-mask-refusal",
        "readiness-pollfd-memory-refusal",
        "socket-readiness-refusal",
        "auxv-source-pointer-refusal",
        "at-random-source-refusal",
        "at-execfn-identity-refusal",
        "target-libc-global-refusal",
        "argv-env-pointer-refusal",
        "private-layout-refusal",
        "shared-mapping-refusal",
        "private-source-pointer-refusal",
        "stale-private-range-refusal",
        "wx-private-mapping-refusal",
        "signal-mask-restart-refusal",
        "pending-signal-refusal",
        "active-signal-frame-refusal",
        "alt-stack-refusal",
        "restart-remaining-time-refusal",
        "socket-transfer-refusal",
        "epoll-wait-refusal",
        "signalfd-read-refusal",
        "futex-refusal",
        "rseq-refusal",
        "restart-state-refusal",
        "jit-self-modifying-refusal",
        "source-vdso-vvar-refusal",
        "raw-cross-isa-vmstate-refusal",
        "descriptor-provenance-refusal",
        "duplicate-fd-alias-refusal",
        "fd-alias-lock-refusal",
        "fd-alias-socket-refusal",
        "fd-alias-epoll-cycle-refusal",
      ]),
    );
    expect(
      summary.profiles.find((profile: { name: string }) => profile.name === "file-writev"),
    ).toMatchObject({
      sourceFixture: "packages/microvm/assets/native-file-writev-target.c",
      traceSyscall: "writev",
      traceFd: 43,
      expectedResult: "success",
      capabilities: expect.arrayContaining(["fd:regular-file", "syscall:active-writev"]),
    });
    expect(
      summary.profiles.find(
        (profile: { name: string }) => profile.name === "socket-transfer-refusal",
      ),
    ).toMatchObject({
      expectedResult: "refusal",
      supportStatus: "intentional-refusal",
      unsafeStateFamily: "socket",
      expectedRefusalCode: "target-socket-syscall-state-unsupported",
      refusesCapabilities: expect.arrayContaining(["fd:socket", "network:active-connection"]),
      descriptorConsumptionExpected: false,
      refusalSupportContract: {
        currentRefusalCode: "target-socket-syscall-state-unsupported",
        graduationRequires: expect.arrayContaining(["portable-state-model", "target-gates"]),
      },
    });
    expect(summary.supportReport).toMatchObject({
      counts: {
        "baseline-success": 47,
        "graduated-support": 626,
        "intentional-refusal": 1474,
        "permanent-refusal": 27,
      },
      graduated: expect.arrayContaining([
        expect.objectContaining({
          name: "eventfd-counter-recreate",
          acceptedSubset: "eventfd-counter-v1-nonsemaphore-no-waiters",
          graduatedFromRefusalCode: "kernel-state-unsupported",
        }),
        expect.objectContaining({
          name: "invalidation-portable-descriptor-hash-mismatch-baseline-recreate",
          acceptedSubset: "portable-descriptor-hash-mismatch-valid-baseline-v1",
          graduatedFromRefusalCode: "portable-descriptor-hash-mismatch",
        }),
        expect.objectContaining({
          name: "invalidation-restore-descriptor-sha256-mismatch-refresh-recreate",
          acceptedSubset: "restore-descriptor-sha256-mismatch-target-native-refresh-v1",
          graduatedFromRefusalCode: "portable-descriptor-hash-mismatch",
        }),
        expect.objectContaining({
          name: "node-blocker-native-addon-n-api-addon-abi-identity-descriptor-recreate",
          acceptedSubset:
            "node-blocker-native-addon-n-api-addon-abi-identity-descriptor-v1-target-native",
        }),
        expect.objectContaining({
          name: "eventfd-alias-counter-recreate",
          acceptedSubset: "eventfd-counter-alias-v1-two-fds-nonsemaphore-no-waiters",
          graduatedFromRefusalCode: "kernel-state-unsupported",
        }),
        expect.objectContaining({
          name: "timerfd-descriptor-recreate",
          acceptedSubset: "timerfd-descriptor-v1-disarmed-or-relative-one-shot",
          graduatedFromRefusalCode: "kernel-state-unsupported",
        }),
        expect.objectContaining({
          name: "pipe-pair-recreate",
          acceptedSubset: "pipe-pair-v1-empty-open-peer-no-waiters",
          graduatedFromRefusalCode: "kernel-state-unsupported",
        }),
        expect.objectContaining({
          name: "pipe-buffered-bytes-recreate",
          acceptedSubset: "pipe-buffered-bytes-v1-open-peer-no-waiters-bounded-payload",
          graduatedFromRefusalCode: "kernel-state-unsupported",
        }),
        expect.objectContaining({
          name: "epoll-recreate",
          acceptedSubset: "single-level-triggered-restorable-fd-watch",
          graduatedFromRefusalCode: "target-epoll-syscall-state-unsupported",
        }),
        expect.objectContaining({
          name: "signalfd-recreate",
          acceptedSubset: "empty-queue-normalized-mask-descriptor",
          graduatedFromRefusalCode: "target-signalfd-state-unsupported",
        }),
        expect.objectContaining({
          name: "eventfd-readiness-pollin-recreate",
          acceptedSubset: "readiness-wait-v1-eventfd-pollin",
          graduatedFromRefusalCode: "kernel-state-unsupported",
        }),
        expect.objectContaining({
          name: "regular-file-duplicate-fd-recreate",
          acceptedSubset: "shared-open-file-description-v1-regular-file-two-fd-alias",
          graduatedFromRefusalCode: "target-fd-table-duplicate",
        }),
        expect.objectContaining({
          name: "target-auxv-at-random",
          acceptedSubset: "target-auxv-v1-at-random-target-owned",
          graduatedFromRefusalCode: "target-process-context-unsupported",
        }),
        expect.objectContaining({
          name: "private-anonymous-data-range-recreate",
          acceptedSubset: "private-layout-v1-single-anonymous-data-range",
          graduatedFromRefusalCode: "mapping-permission-unsupported",
        }),
        expect.objectContaining({
          name: "signal-mask-blocked-recreate",
          acceptedSubset: "target-signal-mask-v1-blocked-mask-only",
          graduatedFromRefusalCode: "signal-state-unsupported",
        }),
        expect.objectContaining({
          name: "tcp-listener-recreate",
          acceptedSubset: "tcp-listener-v1:loopback-no-accepted-connections",
          graduatedFromRefusalCode: "target-socket-syscall-state-unsupported",
        }),
        expect.objectContaining({
          name: "futex-private-wait-wake-recreate",
          acceptedSubset: "futex-private-v1:one-waiter-one-wake",
          graduatedFromRefusalCode: "futex-state-unsupported",
        }),
        expect.objectContaining({
          name: "real-private-multi-range-file-recreate",
          acceptedSubset:
            "real-private-layout-v2:multi-anonymous-data-ranges-with-guards-and-regular-file-fd",
          graduatedFromRefusalCode: "mapping-permission-unsupported",
        }),
        expect.objectContaining({
          name: "real-tcp-listener-recreate",
          acceptedSubset: "real-tcp-listener-v1:loopback-no-accepted-connections",
          graduatedFromRefusalCode: "target-socket-syscall-state-unsupported",
        }),
        expect.objectContaining({
          name: "real-tcp-listener-readiness-recreate",
          acceptedSubset: "real-tcp-listener-readiness-v1:no-queued-accept-target-probe",
          graduatedFromRefusalCode: "target-socket-syscall-state-unsupported",
        }),
        expect.objectContaining({
          name: "real-tcp-active-connection-transport-recreate",
          acceptedSubset: "real-tcp-active-connection-v1:single-plain-stream-explicit-broker",
          graduatedFromRefusalCode: "target-socket-syscall-state-unsupported",
        }),
        expect.objectContaining({
          name: "real-raw-icmp-loopback-recreate",
          acceptedSubset: "raw-icmp-v1:loopback-echo-no-inflight",
          graduatedFromRefusalCode: "target-socket-syscall-state-unsupported",
        }),
        expect.objectContaining({
          name: "real-ping-socket-loopback-recreate",
          acceptedSubset: "ping-socket-v1:loopback-echo-no-inflight",
          graduatedFromRefusalCode: "target-socket-syscall-state-unsupported",
        }),
        expect.objectContaining({
          name: "real-nonroot-ping-socket-loopback-recreate",
          acceptedSubset: "ping-socket-v1:loopback-echo-no-inflight",
          graduatedFromRefusalCode: "target-socket-syscall-state-unsupported",
        }),
        expect.objectContaining({
          name: "real-distro-ping-socket-loopback-recreate",
          acceptedSubset: "ping-socket-v2:loopback-echo-active-recvmsg-empty-queue",
          graduatedFromRefusalCode: "target-socket-syscall-state-unsupported",
        }),
      ]),
      capabilitySummary: {
        accepted: expect.objectContaining({ "fd:regular-file": 8 }),
        refused: expect.objectContaining({ "fd:socket": 6, "syscall:active-recvmsg": 18 }),
      },
    });
    expect(summary.supportReport.intentionallyRefused).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "raw-cross-isa-vmstate-refusal",
          supportStatus: "permanent-refusal",
        }),
      ]),
    );
  });

  it("guardrails real Node app smoke profiles", () => {
    const profiles = JSON.parse(
      readFileSync(join(REPO_ROOT, "scripts/portable-machine-proof-profiles.json"), "utf8"),
    );
    const nodeApps = profiles.filter((profile: { capabilities?: string[] }) =>
      profile.capabilities?.some((capability) => capability.startsWith("runtime:node:app:")),
    );

    expect(nodeApps).toHaveLength(10);
    for (const profile of nodeApps) {
      expect(profile.sourceFixture).toMatch(/^real-node-app:/);
      expect(profile.expectedResult).toBe("success");
      expect(profile.expectedGates).toContain("node-app-output");
      expect(profile.targetOutputVerifier?.expectedOutput).toEqual(expect.any(String));
      expect(profile.appHarness).toEqual(expect.stringMatching(/^docs\/snapshot\/app-harnesses\//));
      expect(profile.checkedSummary).toEqual(
        expect.stringMatching(/^docs\/snapshot\/checked-summaries\/node-apps\//),
      );
      expect(
        existsSync(join(REPO_ROOT, profile.sourceFixture.replace(/^real-node-app:/, ""))),
      ).toBe(true);
      expect(existsSync(join(REPO_ROOT, profile.appHarness))).toBe(true);
      expect(existsSync(join(REPO_ROOT, profile.checkedSummary))).toBe(true);
      expect(Object.keys(profile).filter((key) => key.startsWith("synthetic"))).toEqual([]);
    }
  });

  it("records live Node capture artifacts without forbidden shortcut paths", () => {
    const dir = tempDir();
    const outFile = join(dir, "live-source.json");

    const result = spawnSync(
      "node",
      [
        NODE_LIVE_RESTORE_SMOKE,
        "run",
        "--role",
        "source",
        "--host-label",
        "test-source",
        "--repo-root",
        REPO_ROOT,
        "--out",
        outFile,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );

    expect(result.status).toBe(0);
    const summary = JSON.parse(readFileSync(outFile, "utf8"));
    expect(summary.state).toBe("completed");
    expect(summary.profileCount).toBe(10);
    for (const capture of summary.results) {
      expect(capture.liveProcessObserved).toBe(true);
      expect(capture.outputPassed).toBe(true);
      expect(capture.captureArtifacts.process).toEqual(expect.any(String));
      expect(capture.forbiddenSuccessPaths).toEqual({
        sourceIsaEmulationUsed: false,
        sourceTextReusedAsTargetCode: false,
        sidecarRuntimeUsed: false,
        appHooksRequired: false,
        metadataOnlyCapture: false,
      });
    }
  });

  it("records non-Node runtime proof-or-refusal artifacts", () => {
    const dir = tempDir();
    const out = join(dir, "non-node.json");
    const result = spawnSync(
      "node",
      [
        NON_NODE_RUNTIME_PROOF,
        "run-suite",
        "--runtime",
        "all",
        "--host-label",
        "test-non-node-runtime",
        "--out",
        out,
        "--work-dir",
        join(dir, "work"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const summary = JSON.parse(readFileSync(out, "utf8"));
    expect(summary.state).toBe("completed");
    expect(["supported", "refused"]).toContain(summary.runtimes.jvm.state);
    expect(["supported", "refused"]).toContain(summary.runtimes.python.state);
    expect(["supported", "refused"]).toContain(summary.runtimes.ruby.state);
    expect(["supported", "refused"]).toContain(summary.runtimes.go.state);
    expect(summary.targetRestore).toMatchObject({
      migrationCompleted: true,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      sourceTextReusedAsTargetCode: false,
      appHooksRequired: false,
    });
  });

  it("validates non-Node runtime checked-summary matrix", () => {
    const result = spawnSync(
      "node",
      [
        PROOF_MATRIX,
        "--preset",
        "non-node-runtimes",
        "--check-summary-dir",
        join(REPO_ROOT, "docs/snapshot/checked-summaries/non-node-runtimes"),
        "--json",
        "--summary",
        join(tempDir(), "non-node-runtime-matrix.json"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pass).toBe(true);
    expect(parsed.profileCounts.total).toBe(5);
  });

  it("validates Goal 43 PostgreSQL cross-architecture checked-summary matrix", () => {
    const result = spawnSync(
      "node",
      [
        PROOF_MATRIX,
        "--preset",
        "postgres-machinen",
        "--check-summary-dir",
        join(REPO_ROOT, "docs/snapshot/checked-summaries/postgres-machinen"),
        "--json",
        "--summary",
        join(tempDir(), "postgres-machinen-matrix.json"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pass).toBe(true);
    expect(parsed.profileCounts.total).toBe(10);
  });

  it("validates Goal 42 Go quiescent runtime checked-summary matrix", () => {
    const result = spawnSync(
      "node",
      [
        PROOF_MATRIX,
        "--preset",
        "go-quiescent-runtime",
        "--check-summary-dir",
        join(REPO_ROOT, "docs/snapshot/checked-summaries/go-quiescent-runtime"),
        "--json",
        "--summary",
        join(tempDir(), "go-quiescent-runtime-matrix.json"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pass).toBe(true);
    expect(parsed.profileCounts.total).toBe(10);
  });

  it("validates Goal 40 hard runtime-state checked-summary matrix", () => {
    const result = spawnSync(
      "node",
      [
        PROOF_MATRIX,
        "--preset",
        "goal40-hard-state",
        "--check-summary-dir",
        join(REPO_ROOT, "docs/snapshot/checked-summaries/goal40-hard-state"),
        "--json",
        "--summary",
        join(tempDir(), "goal40-hard-state-matrix.json"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pass).toBe(true);
    expect(parsed.profileCounts.total).toBe(7);
  });

  it("validates non-Node cross-architecture checked-summary matrix", () => {
    const result = spawnSync(
      "node",
      [
        PROOF_MATRIX,
        "--preset",
        "non-node-cross-arch",
        "--check-summary-dir",
        join(REPO_ROOT, "docs/snapshot/checked-summaries/non-node-cross-arch"),
        "--json",
        "--summary",
        join(tempDir(), "non-node-cross-arch-matrix.json"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pass).toBe(true);
    expect(parsed.profileCounts.total).toBe(2);
  });

  it("records no-install ecosystem Node proof artifacts and rejects same-arch restore", () => {
    const dir = tempDir();
    const sourceFile = join(dir, "ecosystem-source.json");
    const targetFile = join(dir, "ecosystem-target.json");

    const sourceResult = spawnSync(
      "node",
      [
        NODE_ECOSYSTEM_RESTORE_PROOF,
        "run-suite",
        "--role",
        "source",
        "--host-label",
        "test-ecosystem-source",
        "--out",
        sourceFile,
        "--work-dir",
        join(dir, "source-work"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(sourceResult.status).toBe(0);
    const source = JSON.parse(readFileSync(sourceFile, "utf8"));
    expect(source.state).toBe("completed");
    expect(source.app.state).toBe("supported");
    expect(source.nativePrebuild.state).toBe("supported");
    expect(source.lockfile.state).toBe("supported");
    expect(source.sandbox).toMatchObject({
      networkAllowed: false,
      lifecycleScriptsAllowed: false,
      thirdPartyCodeAllowed: false,
      packageManagerInvoked: false,
      userConfigRead: false,
    });
    expect(source.lifecycle).toHaveLength(4);
    expect(source.securityInspection).toMatchObject({
      thirdPartyFetchUsed: false,
      thirdPartyInstallUsed: false,
      lifecycleScriptsExecuted: false,
      sourceIsaEmulationArtifactFound: false,
      passed: true,
    });

    const targetResult = spawnSync(
      "node",
      [
        NODE_ECOSYSTEM_RESTORE_PROOF,
        "run-suite",
        "--role",
        "target",
        "--host-label",
        "test-ecosystem-target",
        "--source-suite",
        sourceFile,
        "--out",
        targetFile,
        "--work-dir",
        join(dir, "target-work"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(targetResult.status).toBe(1);
    const target = JSON.parse(readFileSync(targetFile, "utf8"));
    expect(target.route.crossArch).toBe(false);
    expect(target.targetRestore.migrationCompleted).toBe(false);
    expect(target.targetRestore.sourceIsaEmulationUsed).toBe(false);
  });

  it("validates no-install ecosystem Node checked-summary matrix", () => {
    const result = spawnSync(
      "node",
      [
        PROOF_MATRIX,
        "--preset",
        "node-ecosystem",
        "--check-summary-dir",
        join(REPO_ROOT, "docs/snapshot/checked-summaries/node-ecosystem"),
        "--json",
        "--summary",
        join(tempDir(), "node-ecosystem-matrix.json"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pass).toBe(true);
    expect(parsed.profileCounts.total).toBe(5);
  });

  it("records complex Node proof artifacts and rejects same-arch restore", () => {
    const dir = tempDir();
    const sourceFile = join(dir, "complex-source.json");
    const targetFile = join(dir, "complex-target.json");

    const sourceResult = spawnSync(
      "node",
      [
        NODE_COMPLEX_RESTORE_PROOF,
        "run-suite",
        "--role",
        "source",
        "--host-label",
        "test-complex-source",
        "--out",
        sourceFile,
        "--work-dir",
        join(dir, "source-work"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 180_000 },
    );
    expect(sourceResult.status).toBe(0);
    const source = JSON.parse(readFileSync(sourceFile, "utf8"));
    expect(source.state).toBe("completed");
    expect(source.framework.state).toBe("supported");
    expect(["supported", "partial"]).toContain(source.persistence.state);
    expect(source.networking.websocket.state).toBe("supported");
    expect(source.topology.leakAudit).toMatchObject({ orphanedProcesses: 0, leakedSockets: 0 });
    expect(source.publishedNative.state).toBe("supported");
    expect(source.loadAndFailure.passRate).toBe(1);
    expect(source.securityInspection).toMatchObject({
      sourceIsaEmulationArtifactFound: false,
      sidecarRuntimeArtifactFound: false,
      sourceTextReplayArtifactFound: false,
      appHookArtifactFound: false,
      passed: true,
    });

    const targetResult = spawnSync(
      "node",
      [
        NODE_COMPLEX_RESTORE_PROOF,
        "run-suite",
        "--role",
        "target",
        "--host-label",
        "test-complex-target",
        "--source-suite",
        sourceFile,
        "--out",
        targetFile,
        "--work-dir",
        join(dir, "target-work"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 180_000 },
    );
    expect(targetResult.status).toBe(1);
    const target = JSON.parse(readFileSync(targetFile, "utf8"));
    expect(target.route.crossArch).toBe(false);
    expect(target.targetRestore.migrationCompleted).toBe(false);
    expect(target.targetRestore.sourceIsaEmulationUsed).toBe(false);
  });

  it("validates complex Node checked-summary matrix", () => {
    const result = spawnSync(
      "node",
      [
        PROOF_MATRIX,
        "--preset",
        "node-complex",
        "--check-summary-dir",
        join(REPO_ROOT, "docs/snapshot/checked-summaries/node-complex"),
        "--json",
        "--summary",
        join(tempDir(), "node-complex-matrix.json"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pass).toBe(true);
    expect(parsed.profileCounts.total).toBe(7);
  });

  it("records expanded Node proof artifacts and rejects same-arch reverse-route restore", () => {
    const dir = tempDir();
    const sourceFile = join(dir, "expanded-source.json");
    const targetFile = join(dir, "expanded-target.json");

    const sourceResult = spawnSync(
      "node",
      [
        NODE_EXPANDED_RESTORE_PROOF,
        "run-suite",
        "--role",
        "source",
        "--host-label",
        "test-expanded-source",
        "--out",
        sourceFile,
        "--work-dir",
        join(dir, "source-work"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(sourceResult.status).toBe(0);
    const source = JSON.parse(readFileSync(sourceFile, "utf8"));
    expect(source.state).toBe("completed");
    expect(source.arbitraryExistingProcesses).toHaveLength(3);
    expect(
      source.arbitraryExistingProcesses.every(
        (entry: { liveProcessObserved?: boolean }) => entry.liveProcessObserved !== false,
      ),
    ).toBe(true);
    expect(source.activeTcp).toMatchObject({
      state: "supported",
      originalClientCompletedSameLogicalRequest: true,
    });
    expect(source.childProcess.ipcContinuityVerified).toBe(true);
    expect(source.inspector.restorePolicy).toMatchObject({
      state: "refused",
      expectedRefusalCode: "node-inspector-session-active-unsupported",
      migrationCompleted: false,
    });
    expect(source.dirtyState.noLostAcknowledgedWrites).toBe(true);
    expect(source.nativeAddons.state).toBe("supported");
    expect(source.securityInspection).toMatchObject({
      sourceIsaEmulationArtifactFound: false,
      sidecarRuntimeArtifactFound: false,
      sourceTextReplayArtifactFound: false,
      appHookArtifactFound: false,
      passed: true,
    });

    const targetResult = spawnSync(
      "node",
      [
        NODE_EXPANDED_RESTORE_PROOF,
        "run-suite",
        "--role",
        "target",
        "--host-label",
        "test-expanded-target",
        "--source-suite",
        sourceFile,
        "--out",
        targetFile,
        "--work-dir",
        join(dir, "target-work"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(targetResult.status).toBe(1);
    const target = JSON.parse(readFileSync(targetFile, "utf8"));
    expect(target.route.crossArch).toBe(false);
    expect(target.targetRestore.migrationCompleted).toBe(false);
    expect(target.targetRestore.sourceIsaEmulationUsed).toBe(false);
  });

  it("validates expanded Node checked-summary matrix", () => {
    const result = spawnSync(
      "node",
      [
        PROOF_MATRIX,
        "--preset",
        "node-expanded",
        "--check-summary-dir",
        join(REPO_ROOT, "docs/snapshot/checked-summaries/node-expanded"),
        "--json",
        "--summary",
        join(tempDir(), "node-expanded-matrix.json"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pass).toBe(true);
    expect(parsed.profileCounts.total).toBe(7);
  });

  it("records production-shaped Node proof artifacts and rejects same-arch restore", () => {
    const dir = tempDir();
    const sourceFile = join(dir, "production-source.json");
    const targetFile = join(dir, "production-target.json");

    const sourceResult = spawnSync(
      "node",
      [
        NODE_PRODUCTION_RESTORE_PROOF,
        "run-suite",
        "--role",
        "source",
        "--host-label",
        "test-production-source",
        "--out",
        sourceFile,
        "--work-dir",
        join(dir, "source-work"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(sourceResult.status).toBe(0);
    const source = JSON.parse(readFileSync(sourceFile, "utf8"));
    expect(source.state).toBe("completed");
    expect(source.app.dependencyTree).toHaveLength(1);
    expect(source.app.addon.path).toMatch(/addon\.node$/);
    expect(source.capture.activeConnectionPolicy).toMatchObject({
      state: "refused",
      expectedRefusalCode: "node-live-active-http-connection-unverified",
      migrationCompleted: false,
    });
    expect(source.securityInspection).toMatchObject({
      sourceIsaEmulationArtifactFound: false,
      sidecarRuntimeArtifactFound: false,
      sourceTextReplayArtifactFound: false,
      appHookArtifactFound: false,
      passed: true,
    });

    const targetResult = spawnSync(
      "node",
      [
        NODE_PRODUCTION_RESTORE_PROOF,
        "run-suite",
        "--role",
        "target",
        "--host-label",
        "test-production-target",
        "--source-suite",
        sourceFile,
        "--out",
        targetFile,
        "--work-dir",
        join(dir, "target-work"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );
    expect(targetResult.status).toBe(1);
    const target = JSON.parse(readFileSync(targetFile, "utf8"));
    expect(target.targetRestore.migrationCompleted).toBe(false);
    expect(target.targetRestore.sourceIsaEmulationUsed).toBe(false);
    expect(target.portableBundle.nativeAddonProvenanceValidated).toBe(true);
  });

  it("rejects same-architecture Node app cross-arch smoke comparisons", () => {
    const dir = tempDir();
    const source = {
      role: "source",
      hostLabel: "source-arm64",
      node: { version: "v24.0.0", arch: "arm64", platform: "linux" },
      results: [
        {
          profile: "node-app-cli-script-recreate",
          outputPassed: true,
          fixtureSha256: "abc",
          expectedOutput: "node-cli-ok",
          stdout: "node-cli-ok\n",
          targetOutputVerifier: { kind: "node-real-app-output" },
        },
      ],
    };
    const target = {
      role: "target",
      hostLabel: "target-arm64",
      node: { version: "v24.0.0", arch: "arm64", platform: "linux" },
      results: [
        {
          profile: "node-app-cli-script-recreate",
          outputPassed: true,
          fixtureSha256: "abc",
          expectedOutput: "node-cli-ok",
          stdout: "node-cli-ok\n",
          targetOutputVerifier: { kind: "node-real-app-output" },
        },
      ],
    };
    const sourceFile = join(dir, "source.json");
    const targetFile = join(dir, "target.json");
    const outFile = join(dir, "summary.json");
    writeFileSync(sourceFile, JSON.stringify(source));
    writeFileSync(targetFile, JSON.stringify(target));

    const result = spawnSync(
      "node",
      [
        NODE_CROSS_ARCH_SMOKE,
        "compare",
        "--source",
        sourceFile,
        "--target",
        targetFile,
        "--out",
        outFile,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV },
    );

    expect(result.status).toBe(1);
    const summary = JSON.parse(readFileSync(outFile, "utf8"));
    expect(summary.pass).toBe(false);
    expect(summary.profiles[0].crossArchitecture).toBe(false);
    expect(summary.profiles[0].targetRestore.migrationCompleted).toBe(false);
    expect(summary.profiles[0].targetRestore.sourceIsaEmulationUsed).toBe(false);
    expect(summary.profiles[0].targetRestore.sourceTextReusedAsTargetCode).toBe(false);
  });

  it("validates profile schema and capability coverage", () => {
    const result = spawnSync("node", [RUNNER, "--validate-schema", "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: SCRIPT_ENV,
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ passed: true, errors: [] });
  });

  it("runs a named profile through dry-run smoke wiring without reporting success", () => {
    const dir = tempDir();
    const result = spawnSync(
      "node",
      [
        RUNNER,
        "--profile",
        "file-readv",
        "--dry-run",
        "--json",
        "--work-dir-prefix",
        join(dir, "proof-"),
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: SCRIPT_ENV,
        timeout: 60_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      profile: "file-readv",
      remoteSourceTarget: "file-readv",
      state: "skipped",
      pass: false,
      dryRun: true,
    });
    expect(summary.workDir).toContain(join(dir, "proof-"));
    expect(summary.smokeSummary).toMatchObject({
      state: "skipped",
      skipReason: "dry run",
      remoteE2e: 1,
      remoteSourceTarget: "file-readv",
    });
    expect(summary.gateCheck.passed).toBe(false);
    expect(summary.gateCheck.failures.map((failure: { label: string }) => failure.label)).toContain(
      "summary.state",
    );
  });

  it("checks a successful summary with all required gates", () => {
    const dir = tempDir();
    const summaryFile = join(dir, "summary.json");
    writeFileSync(summaryFile, JSON.stringify(completedSummary(), null, 2));

    const result = spawnSync(
      "node",
      [RUNNER, "--profile", "file-write", "--check-summary", summaryFile, "--json"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: SCRIPT_ENV,
        timeout: 30_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      profile: "file-write",
      state: "completed",
      pass: true,
      gateCheck: { passed: true, failures: [] },
    });
  });

  it("checks a process-context summary without requiring the active-syscall gate", () => {
    const dir = tempDir();
    const summaryFile = join(dir, "summary.json");
    writeFileSync(summaryFile, JSON.stringify(completedSummary("process-context"), null, 2));

    const result = spawnSync(
      "node",
      [RUNNER, "--profile", "process-context", "--check-summary", summaryFile, "--json"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: SCRIPT_ENV,
        timeout: 30_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      profile: "process-context",
      state: "completed",
      pass: true,
    });
    expect(summary.gateCheck.checks.map((check: { label: string }) => check.label)).toContain(
      "targetRestore.targetProcessContextRestoreResult",
    );
  });

  it.each(negativeProfiles)(
    "checks expected refusal profile %s without allowing migration completion",
    (profile, code) => {
      const dir = tempDir();
      const summaryFile = join(dir, "summary.json");
      writeFileSync(summaryFile, JSON.stringify(refusedSummary(profile, code), null, 2));

      const result = spawnSync(
        "node",
        [RUNNER, "--profile", profile, "--check-summary", summaryFile, "--json"],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: SCRIPT_ENV,
          timeout: 30_000,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({
        profile,
        state: "refused",
        pass: true,
        gateCheck: { passed: true, failures: [] },
      });
      expect(summary.gateCheck.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "refusal.code", actual: code }),
          expect.objectContaining({ label: "targetRestore.migrationCompleted", actual: false }),
          expect.objectContaining({
            label: "targetRestore.descriptorGateCompleted",
            actual: false,
          }),
        ]),
      );
    },
  );

  it.each(negativeProfiles)(
    "runs synthetic negative profile %s as a first-class refusal proof",
    (profile, code) => {
      const dir = tempDir();
      const result = spawnSync(
        "node",
        [RUNNER, "--profile", profile, "--json", "--work-dir-prefix", join(dir, "proof-")],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: SCRIPT_ENV,
          timeout: 30_000,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({
        profile,
        remoteSourceTarget: profile,
        state: "refused",
        pass: true,
        exitStatus: 0,
        smokeSummary: {
          state: "failed",
          remoteSourceTarget: profile,
          targetRestore: {
            state: "refused",
            migrationCompleted: false,
            descriptorGateCompleted: false,
            refusal: { code },
            sourceTextReusedAsTargetCode: false,
            sourceIsaEmulationUsed: false,
            sidecarRuntimeUsed: false,
          },
        },
        gateCheck: { passed: true, failures: [] },
      });
      expect(summary.command).toEqual(["bash", "synthetic-negative", profile]);
      expect(existsSync(summary.logs.runnerSummary)).toBe(true);
      expect(existsSync(summary.logs.smokeSummary)).toBe(true);
      expect(existsSync(summary.logs.targetRestore)).toBe(true);
    },
  );

  it("runs a Goal 25 live-capture negative proof without fallback shortcuts", () => {
    const dir = tempDir();
    const result = spawnSync(
      "node",
      [
        RUNNER,
        "--profile",
        "udp-loopback-single-queued-datagram-v1-multiple-datagrams-refusal",
        "--json",
        "--work-dir-prefix",
        join(dir, "proof-"),
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: SCRIPT_ENV,
        timeout: 30_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      profile: "udp-loopback-single-queued-datagram-v1-multiple-datagrams-refusal",
      state: "refused",
      pass: true,
      command: [
        "bash",
        "live-capture-negative",
        "udp-loopback-single-queued-datagram-v1-multiple-datagrams-refusal",
      ],
      smokeSummary: {
        state: "failed",
        targetRestore: {
          state: "refused",
          migrationCompleted: false,
          descriptorGateCompleted: false,
          concreteFixtureResult: "refused",
          liveSourceCaptureResult: "captured",
          refusal: { code: "target-socket-syscall-state-unsupported" },
          sourceIsaEmulationUsed: false,
          sidecarRuntimeUsed: false,
          appHooksRequired: false,
        },
      },
      gateCheck: { passed: true, failures: [] },
    });
    expect(summary.smokeSummary.remotePreflight.sourceCapture).toMatchObject({
      path: expect.stringContaining("goal21-live-source-capture-fixtures.json"),
      exists: true,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(summary.proofProvenance.artifacts.restoreDescriptor).toMatchObject({
      path: expect.stringContaining("goal21-negative-descriptor-fixtures.json"),
      exists: true,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("runs a Goal 25 live-capture positive proof with target-native provenance artifacts", () => {
    const dir = tempDir();
    const result = spawnSync(
      "node",
      [
        RUNNER,
        "--profile",
        "udp-loopback-single-queued-datagram-v1-recreate",
        "--json",
        "--work-dir-prefix",
        join(dir, "proof-"),
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: SCRIPT_ENV,
        timeout: 30_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      profile: "udp-loopback-single-queued-datagram-v1-recreate",
      state: "completed",
      pass: true,
      command: ["bash", "live-capture-positive", "udp-loopback-single-queued-datagram-v1-recreate"],
      smokeSummary: {
        state: "completed",
        remoteSourceTarget: "udp-loopback-single-queued-datagram-v1-recreate",
        targetRestore: {
          migrationCompleted: true,
          descriptorGateCompleted: true,
          concreteFixtureResult: "completed",
          liveSourceCaptureResult: "captured",
          sourceIsaEmulationUsed: false,
          sidecarRuntimeUsed: false,
        },
      },
      gateCheck: { passed: true, failures: [] },
    });
    expect(summary.smokeSummary.remotePreflight.sourceCapture).toMatchObject({
      path: expect.stringContaining("goal21-live-source-capture-fixtures.json"),
      exists: true,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(summary.proofProvenance.artifacts.restoreDescriptor).toMatchObject({
      path: expect.stringContaining("goal21-positive-descriptor-fixtures.json"),
      exists: true,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(summary.proofProvenance.artifacts.targetContinuation).toMatchObject({
      exists: true,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("rejects a negative profile summary that reports target-native success", () => {
    const dir = tempDir();
    const badSummary = refusedSummary();
    badSummary.state = "completed";
    badSummary.targetRestore.state = "completed";
    badSummary.targetRestore.migrationCompleted = true;
    badSummary.targetRestore.descriptorGateCompleted = true;
    const summaryFile = join(dir, "summary.json");
    writeFileSync(summaryFile, JSON.stringify(badSummary, null, 2));

    const result = spawnSync(
      "node",
      [RUNNER, "--profile", "socket-transfer-refusal", "--check-summary", summaryFile, "--json"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: SCRIPT_ENV,
        timeout: 30_000,
      },
    );

    expect(result.status).toBe(1);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({ profile: "socket-transfer-refusal", pass: false });
    expect(summary.gateCheck.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "summary.state" }),
        expect.objectContaining({ label: "targetRestore.migrationCompleted" }),
        expect.objectContaining({ label: "targetRestore.descriptorGateCompleted" }),
      ]),
    );
  });

  it("rejects a graduated support profile unless descriptor and target gates pass", () => {
    const dir = tempDir();
    const profileFile = join(dir, "profiles.json");
    const badSummaryFile = join(dir, "summary.json");
    const profile = {
      name: "graduated-epoll",
      remoteSourceTarget: "graduated-epoll",
      sourceFixture: "synthetic",
      expectedResult: "success",
      supportStatus: "graduated-support",
      unsafeStateFamily: "epoll",
      graduatedFromRefusalCode: "target-epoll-syscall-state-unsupported",
      acceptedSubset: "single-level-triggered-watch",
      unsafeVariants: ["epoll-wait-refusal"],
      expectedGates: ["descriptor", "resources", "verifier"],
    };
    writeFileSync(profileFile, JSON.stringify([profile], null, 2));
    const badSummary = completedSummary("graduated-epoll");
    badSummary.targetRestore.descriptorGateCompleted = false;
    writeFileSync(badSummaryFile, JSON.stringify(badSummary, null, 2));

    const result = spawnSync(
      "node",
      [RUNNER, "--profile", "graduated-epoll", "--check-summary", badSummaryFile, "--json"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...SCRIPT_ENV, PORTABLE_MACHINE_PROOF_PROFILES: profileFile },
        timeout: 30_000,
      },
    );

    expect(result.status).toBe(1);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({ profile: "graduated-epoll", pass: false });
    expect(summary.gateCheck.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "graduated profile descriptor gate completed before success",
        }),
        expect.objectContaining({ label: "targetRestore.descriptorGateCompleted" }),
      ]),
    );
  });

  it("refuses a summary that is missing a descriptor gate", () => {
    const dir = tempDir();
    const badSummary = completedSummary();
    badSummary.targetRestore.descriptorGateCompleted = false;
    const summaryFile = join(dir, "summary.json");
    writeFileSync(summaryFile, JSON.stringify(badSummary, null, 2));

    const result = spawnSync(
      "node",
      [RUNNER, "--profile", "file-write", "--check-summary", summaryFile, "--json"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: SCRIPT_ENV,
        timeout: 30_000,
      },
    );

    expect(result.status).toBe(1);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      profile: "file-write",
      state: "failed",
      pass: false,
    });
    expect(summary.gateCheck.failures).toContainEqual(
      expect.objectContaining({ label: "targetRestore.descriptorGateCompleted" }),
    );
  });
});
