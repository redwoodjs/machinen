import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-real-utility-final-jump.ts");
const TMP: string[] = [];

interface NativeRealUtilityFinalJumpSummary {
  skipped?: boolean;
  reason?: string;
  phase?: string;
  plan?: { state: string; blockingBoundary: string };
  materializedTargetBytes?: { sourceTextReusedAsTargetCode: boolean; sizeBytes: number };
  attemptedResume?: boolean;
  sourceTextReusedAsTargetCode?: boolean;
  sourceIsaEmulationUsed?: boolean;
  sidecarRuntimeUsed?: boolean;
  execution?: string;
  resumeEvent?: { status: string; targetArch: string; usedTargetStack: boolean };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native real utility final jump proof", () => {
  it(
    "jumps into target-native amd64 bytes after modeled real-utility gates",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-real-utility-final-jump-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", cwd: REPO_ROOT, env: process.env, maxBuffer: 20 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as NativeRealUtilityFinalJumpSummary;
      if (summary.skipped) {
        expect(process.platform !== "linux" || process.arch !== "x64").toBe(true);
        expect(summary.reason).toBeTruthy();
        return;
      }

      expect(summary.phase).toBe("native-real-utility-final-jump");
      expect(summary.plan).toMatchObject({ state: "ready", blockingBoundary: "ready" });
      expect(summary.materializedTargetBytes).toMatchObject({
        sourceTextReusedAsTargetCode: false,
      });
      expect(summary.materializedTargetBytes?.sizeBytes).toBeGreaterThan(0);
      expect(summary.attemptedResume).toBe(true);
      expect(summary.sourceTextReusedAsTargetCode).toBe(false);
      expect(summary.sourceIsaEmulationUsed).toBe(false);
      expect(summary.sidecarRuntimeUsed).toBe(false);
      expect(summary.resumeEvent).toMatchObject({
        status: "jumped",
        targetArch: "amd64",
        usedTargetStack: true,
      });
      expect(summary.execution).toBe(
        "real-utility-shaped-continuation-jumped-target-native-amd64-code",
      );
    },
  );
});
