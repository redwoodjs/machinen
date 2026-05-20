import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-captured-final-jump.ts");
const SOURCE_BUNDLE_ENV = "MACHINEN_NATIVE_CAPTURED_FINAL_JUMP_SOURCE_BUNDLE";
const TMP: string[] = [];

interface NativeCapturedFinalJumpSummary {
  skipped?: boolean;
  reason?: string;
  phase?: "capture-source" | "target-final-jump";
  sourceBundleDir?: string;
  bundleDir?: string;
  capturedSourcePc?: string;
  capturedSourcePointer?: string;
  sourceInitialWord0?: string;
  translatedEntry?: string;
  translatedArgument?: string;
  execution?: string;
  resumeEvent?: {
    status: string;
    targetArch: string;
    entry: string;
    argument: string;
    returnValue: string;
    storedMarker: string;
    usedTargetStack: boolean;
  };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native captured final jump", () => {
  it(
    "captures an arm64 source bundle or jumps it on amd64 when a source bundle is provided",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-captured-final-jump-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        {
          encoding: "utf8",
          cwd: REPO_ROOT,
          env: process.env,
          maxBuffer: 20 * 1024 * 1024,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as NativeCapturedFinalJumpSummary;
      if (summary.skipped) {
        expect(
          process.platform !== "linux" ||
            (process.arch === "x64" && !process.env[SOURCE_BUNDLE_ENV]) ||
            (process.arch !== "x64" && process.arch !== "arm64"),
        ).toBe(true);
        expect(summary.reason).toBeTruthy();
        return;
      }

      expect(summary.capturedSourcePc).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.capturedSourcePointer).toMatch(/^0x[0-9a-f]+$/);
      if (summary.phase === "capture-source") {
        expect(process.arch).toBe("arm64");
        expect(summary.sourceInitialWord0).toBe(summary.capturedSourcePointer);
        expect(summary.execution).toBe("captured-arm64-source-awaiting-amd64-final-jump");
        expect(summary.sourceBundleDir).toBeTruthy();
        validateNativeProcessImageBundle(summary.sourceBundleDir!);
        return;
      }

      expect(summary.phase).toBe("target-final-jump");
      expect(summary.translatedEntry).toBe("0x14000080");
      expect(summary.translatedArgument).toBe("0x15000000");
      expect(summary.execution).toBe("captured-arm64-source-jumped-target-native-amd64-code");
      expect(summary.resumeEvent).toMatchObject({
        status: "jumped",
        targetArch: "amd64",
        entry: "0x14000080",
        argument: "0x15000000",
        returnValue: "0x4d",
        storedMarker: "0x4e454e494843414d",
        usedTargetStack: true,
      });
      const bundle = validateNativeProcessImageBundle(summary.bundleDir!);
      expect(bundle.manifest.capture.sourceArch).toBe("arm64");
      expect(bundle.manifest.target.arch).toBe("amd64");
    },
  );
});
