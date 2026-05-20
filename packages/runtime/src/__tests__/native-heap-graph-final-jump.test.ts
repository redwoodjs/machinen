import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-heap-graph-final-jump.ts");
const SOURCE_BUNDLE_ENV = "MACHINEN_NATIVE_HEAP_GRAPH_SOURCE_BUNDLE";
const TMP: string[] = [];

interface NativeHeapGraphFinalJumpSummary {
  skipped?: boolean;
  reason?: string;
  phase?: "capture-source" | "heap-graph-final-jump";
  sourceBundleDir?: string;
  bundleDir?: string;
  capturedSourcePc?: string;
  capturedSourcePointer?: string;
  capturedSourceReturnAddress?: string;
  sourceNodeA?: string;
  sourceNodeB?: string;
  graphChecksum?: string;
  translatedEntry?: string;
  translatedReturnAddress?: string;
  translatedNodeA?: string;
  translatedNodeB?: string;
  memoryRelocations?: number;
  execution?: string;
  resumeEvent?: {
    status: string;
    targetArch: string;
    entry: string;
    argument: string;
    returnValue: string;
    storedMarker: string;
    returnAddress: string;
    returnMarker: string;
    graphChecksum: string;
    returnedToTranslatedAddress: boolean;
    usedTargetStack: boolean;
  };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native heap-graph final jump", () => {
  it(
    "captures an arm64 heap graph or walks it after the translated amd64 return",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-heap-graph-final-jump-test-"));
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
      const summary = JSON.parse(result.stdout) as NativeHeapGraphFinalJumpSummary;
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
      expect(summary.capturedSourceReturnAddress).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.sourceNodeA).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.sourceNodeB).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.graphChecksum).toBe("0x4d");
      if (summary.phase === "capture-source") {
        expect(process.arch).toBe("arm64");
        expect(summary.execution).toBe(
          "captured-arm64-source-awaiting-amd64-heap-graph-final-jump",
        );
        expect(summary.sourceBundleDir).toBeTruthy();
        validateNativeProcessImageBundle(summary.sourceBundleDir!);
        return;
      }

      expect(summary.phase).toBe("heap-graph-final-jump");
      expect(summary.translatedEntry).toBe("0x14000080");
      expect(summary.translatedNodeA).toBe("0x15001000");
      expect(summary.translatedNodeB).toBe("0x15001040");
      expect(summary.memoryRelocations).toBeGreaterThanOrEqual(3);
      expect(summary.execution).toBe("captured-arm64-heap-graph-walked-after-native-amd64-ret");
      expect(summary.resumeEvent).toMatchObject({
        status: "jumped",
        targetArch: "amd64",
        entry: "0x14000080",
        argument: "0x15000000",
        returnValue: "0x4d",
        storedMarker: "0x4e454e494843414d",
        returnMarker: "0x52455455524e4a50",
        graphChecksum: "0x4d",
        returnedToTranslatedAddress: true,
        usedTargetStack: true,
      });
      expect(summary.resumeEvent?.returnAddress).toBe(summary.translatedReturnAddress);
      const bundle = validateNativeProcessImageBundle(summary.bundleDir!);
      expect(bundle.manifest.capture.sourceArch).toBe("arm64");
      expect(bundle.manifest.target.arch).toBe("amd64");
      expect(
        bundle.translation.memoryRelocations.filter((relocation) => relocation.kind === "pointer")
          .length,
      ).toBeGreaterThanOrEqual(4);
    },
  );
});
