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
    expect(summary.profiles.map((profile: { name: string }) => profile.name)).toEqual([
      "two-thread-ppoll",
      "pipe-read",
      "eventfd-read",
      "timerfd-read",
      "file-read",
      "file-pread",
      "file-readv",
      "file-write",
      "file-pwrite",
      "file-writev",
      "process-context",
    ]);
    expect(
      summary.profiles.find((profile: { name: string }) => profile.name === "file-writev"),
    ).toMatchObject({
      sourceFixture: "packages/microvm/assets/native-file-writev-target.c",
      traceSyscall: "writev",
      traceFd: 43,
      expectedResult: "success",
    });
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
