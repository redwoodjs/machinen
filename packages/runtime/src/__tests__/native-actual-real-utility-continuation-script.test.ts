import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-actual-real-utility-continuation.ts");
const TMP: string[] = [];

interface ActualRealUtilitySummary {
  skipped?: boolean;
  reason?: string;
  phase?: string;
  actualCapturedUtility?: boolean;
  processImageValidated?: boolean;
  threadSyscalls?: Array<{ state: string; name?: string }>;
  blockingBoundary?: string;
  blockingRefusal?: { code: string };
  plan?: { state: string; blockingBoundary: string; blockingRefusal?: { code: string } };
  attemptedResume?: boolean;
  migrationCompleted?: boolean;
  semanticTargetContinuations?: Array<{
    strategy: string;
    symbolName: string;
    targetRelativeAddress: string;
    targetAddress: string;
  }>;
  targetResumeLandingProvenance?: Array<{
    targetAddress: string;
    targetModule: { path: string; buildId: string };
    instructionBoundary: { state: string; reason: string };
  }>;
  targetResumeLandingRefusals?: Array<{ code: string }>;
  targetResumeExecutionAttempt?: {
    attemptedResume: boolean;
    instructionPointerInTargetBytes: boolean;
  };
  sourceTextReusedAsTargetCode?: boolean;
  sourceIsaEmulationUsed?: boolean;
  sidecarRuntimeUsed?: boolean;
  execution?: string;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native actual real utility continuation proof script", () => {
  it(
    "captures or consumes an actual real utility bundle and refuses before unsafe resume",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-actual-real-utility-continuation-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", cwd: REPO_ROOT, env: process.env, maxBuffer: 20 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as ActualRealUtilitySummary;
      if (summary.skipped) {
        expect(process.platform !== "linux" || process.arch !== "arm64").toBe(true);
        expect(summary.reason).toBeTruthy();
        return;
      }

      expect(summary.phase).toBe("actual-real-utility-capture");
      expect(summary.actualCapturedUtility).toBe(true);
      expect(summary.processImageValidated).toBe(true);
      for (const semantic of summary.semanticTargetContinuations ?? []) {
        expect(semantic.strategy).toEqual(expect.any(String));
        expect(semantic.targetAddress).toEqual(expect.any(String));
      }
      for (const landing of summary.targetResumeLandingProvenance ?? []) {
        expect(landing.targetAddress).toEqual(expect.any(String));
        expect(landing.targetModule.path).toEqual(expect.any(String));
        expect(landing.instructionBoundary.state).toEqual(expect.any(String));
      }
      expect(summary.attemptedResume).toBe(
        summary.targetResumeExecutionAttempt?.attemptedResume ?? false,
      );
      expect(summary.migrationCompleted).toBe(false);
      expect(summary.sourceTextReusedAsTargetCode).toBe(false);
      expect(summary.sourceIsaEmulationUsed).toBe(false);
      expect(summary.sidecarRuntimeUsed).toBe(false);
      expect(summary.plan?.state).toBe("refused");
      expect(summary.blockingBoundary).toBe(summary.plan?.blockingBoundary);
      expect(summary.blockingRefusal?.code).toBe(summary.plan?.blockingRefusal?.code);
      if (summary.plan?.state === "refused") {
        expect(summary.execution).toBe(
          `actual-real-utility-refused-at-${summary.blockingBoundary}`,
        );
      } else {
        expect(summary.targetResumeExecutionAttempt?.instructionPointerInTargetBytes).toBe(true);
      }
      expect(summary.threadSyscalls?.length).toBeGreaterThan(0);
    },
  );
});
