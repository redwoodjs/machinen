import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-real-utility.ts");
const TMP: string[] = [];

interface NativeRealUtilitySummary {
  skipped?: boolean;
  reason?: string;
  utility: {
    name: string;
    state: "refused" | "resumed";
    dynamicallyLinked?: boolean;
    processImageValidated: boolean;
    blockingBoundary: string;
    blockingRefusal: { code: string };
    attemptedResume: boolean;
    sourceTextReusedAsTargetCode: boolean;
    targetBinarySource?: string;
    execution: string;
  };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native real utility continuation attempt", () => {
  it.skipIf(process.platform !== "linux")(
    "captures a real dynamically linked utility and stops at an exact boundary",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-real-utility-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", cwd: REPO_ROOT, maxBuffer: 40 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as NativeRealUtilitySummary;
      if (summary.skipped) {
        expect(summary.reason).toMatch(/arm64 Linux source utility|Linux procfs/);
        return;
      }

      expect(summary.utility).toMatchObject({
        name: "sleep",
        state: "refused",
        dynamicallyLinked: true,
        processImageValidated: true,
        attemptedResume: false,
        sourceTextReusedAsTargetCode: false,
      });
      expect([
        "code-location-unknown",
        "kernel-state-unsupported",
        "mapping-ambiguous",
        "mapping-unreadable",
      ]).toContain(summary.utility.blockingRefusal.code);
      expect(summary.utility.execution).toContain(`real-arm64-sleep-refused-at-`);
    },
  );
});
