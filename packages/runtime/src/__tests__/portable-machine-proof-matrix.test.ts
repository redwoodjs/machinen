import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const MATRIX = join(REPO_ROOT, "scripts/portable-machine-proof-matrix.mjs");
const SCRIPT_ENV = { ...process.env, FORCE_COLOR: "1" };
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portable-machine-proof-matrix-"));
  tempDirs.push(dir);
  return dir;
}

function completedSummary(remoteSourceTarget = "file-write") {
  return {
    profile: "portable-machine-restore",
    state: "completed",
    remoteSourceTarget,
    targetRestore: {
      state: "completed",
      targetArch: "amd64",
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
      targetActiveSyscallRestoreResult: "passed",
      targetResumePathResult: "passed",
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    },
    timings: [],
  };
}

function refusedSummary(code = "target-socket-syscall-state-unsupported") {
  return {
    profile: "portable-machine-restore",
    state: "failed",
    remoteSourceTarget: "socket-transfer-refusal",
    targetRestore: {
      state: "refused",
      migrationCompleted: false,
      descriptorGateCompleted: false,
      refusal: { code, message: "unsupported socket" },
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    },
    timings: [],
  };
}

describe("portable machine proof matrix", () => {
  it("selects profiles by capability and emits stable summary JSON", () => {
    const result = spawnSync(
      "node",
      [MATRIX, "--capability", "fd:socket", "--json", "--continue-on-fail"],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 120_000 },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      kind: "machinen.portable-machine-proof-matrix",
      state: "completed",
      pass: true,
      profileCounts: { total: 5 },
      schemaValidation: { passed: true },
    });
    expect(summary.selectedProfiles).toEqual([
      "socket-readiness-refusal",
      "socket-transfer-refusal",
      "fd-alias-socket-refusal",
      "tcp-active-connection-refusal",
      "epoll-socket-readiness-refusal",
    ]);
    expect(summary.refusalCodes).toMatchObject({
      "socket-transfer-refusal": "target-socket-syscall-state-unsupported",
    });
    expect(summary.timings[0]).toMatchObject({ name: "portable-machine-proof-matrix" });
  });

  it("reports mixed pass/fail output when checked summaries disagree with profile contracts", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "file-write.json"), JSON.stringify(completedSummary(), null, 2));
    const badRefusal = refusedSummary();
    badRefusal.targetRestore.migrationCompleted = true;
    writeFileSync(join(dir, "socket-transfer-refusal.json"), JSON.stringify(badRefusal, null, 2));

    const result = spawnSync(
      "node",
      [
        MATRIX,
        "--profile",
        "file-write,socket-transfer-refusal",
        "--check-summary-dir",
        dir,
        "--continue-on-fail",
        "--json",
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 60_000 },
    );

    expect(result.status).toBe(1);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({ state: "failed", pass: false });
    expect(summary.results).toEqual([
      expect.objectContaining({ profile: "file-write", pass: true, state: "completed" }),
      expect.objectContaining({ profile: "socket-transfer-refusal", pass: false }),
    ]);
  });

  it("catches refusal-code drift through matrix verification", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "socket-transfer-refusal.json"),
      JSON.stringify(refusedSummary("kernel-state-unsupported"), null, 2),
    );

    const result = spawnSync(
      "node",
      [MATRIX, "--profile", "socket-transfer-refusal", "--check-summary-dir", dir, "--json"],
      { cwd: REPO_ROOT, encoding: "utf8", env: SCRIPT_ENV, timeout: 60_000 },
    );

    expect(result.status).toBe(1);
    const summary = JSON.parse(result.stdout);
    expect(summary.results[0]).toMatchObject({ profile: "socket-transfer-refusal", pass: false });
    expect(summary.results[0].runnerSummary.gateCheck.failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "refusal.code" })]),
    );
  });
});
