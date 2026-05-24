import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const RUNNER = join(REPO_ROOT, "scripts/portable-machine-proof-runner.mjs");
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
  ["auxv-source-pointer-refusal", "target-process-context-unsupported"],
  ["private-layout-refusal", "mapping-permission-unsupported"],
  ["signal-mask-restart-refusal", "signal-state-unsupported"],
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
] as const;

describe("portable machine proof runner", () => {
  it("lists every current remote proof profile", () => {
    const result = spawnSync("node", [RUNNER, "--list", "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: SCRIPT_ENV,
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    const names = summary.profiles.map((profile: { name: string }) => profile.name);
    expect(names.slice(0, 14)).toEqual([
      "two-thread-ppoll",
      "pipe-read",
      "eventfd-read",
      "eventfd-counter-recreate",
      "timerfd-descriptor-recreate",
      "pipe-pair-recreate",
      "timerfd-read",
      "file-read",
      "file-pread",
      "file-readv",
      "file-write",
      "file-pwrite",
      "file-writev",
      "process-context",
    ]);
    expect(names).toEqual(
      expect.arrayContaining([
        "epoll-recreate",
        "timerfd-descriptor-recreate",
        "pipe-pair-recreate",
        "signalfd-recreate",
        "readiness-wait-refusal",
        "auxv-source-pointer-refusal",
        "private-layout-refusal",
        "signal-mask-restart-refusal",
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
      ]),
    );
    expect(
      summary.profiles.find((profile: { name: string }) => profile.name === "file-writev"),
    ).toMatchObject({
      sourceFixture: "packages/microvm/assets/native-file-writev-target.c",
      traceSyscall: "writev",
      traceFd: 43,
      expectedResult: "success",
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
      descriptorConsumptionExpected: false,
      refusalSupportContract: {
        currentRefusalCode: "target-socket-syscall-state-unsupported",
        graduationRequires: expect.arrayContaining(["portable-state-model", "target-gates"]),
      },
    });
    expect(summary.supportReport).toMatchObject({
      counts: {
        "baseline-success": 11,
        "graduated-support": 5,
        "intentional-refusal": 11,
        "permanent-refusal": 3,
      },
      graduated: [
        expect.objectContaining({
          name: "eventfd-counter-recreate",
          acceptedSubset: "eventfd-counter-v1-nonsemaphore-no-waiters",
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
          name: "epoll-recreate",
          acceptedSubset: "single-level-triggered-restorable-fd-watch",
          graduatedFromRefusalCode: "target-epoll-syscall-state-unsupported",
        }),
        expect.objectContaining({
          name: "signalfd-recreate",
          acceptedSubset: "empty-queue-normalized-mask-descriptor",
          graduatedFromRefusalCode: "target-signalfd-state-unsupported",
        }),
      ],
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
