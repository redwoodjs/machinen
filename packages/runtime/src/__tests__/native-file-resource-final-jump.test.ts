import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-file-resource-final-jump.ts");
const SOURCE_BUNDLE_ENV = "MACHINEN_NATIVE_FILE_RESOURCE_SOURCE_BUNDLE";
const TMP: string[] = [];

interface NativeFileResourceFinalJumpSummary {
  skipped?: boolean;
  reason?: string;
  phase?: "capture-source" | "file-resource-final-jump";
  sourceBundleDir?: string;
  bundleDir?: string;
  capturedSourcePc?: string;
  capturedSourcePointer?: string;
  capturedSourceReturnAddress?: string;
  regularFileFd?: number;
  sourceResourcePath?: string;
  translatedResourcePath?: string;
  sourceResourceOffset?: number;
  resourceChecksum?: string;
  translatedEntry?: string;
  translatedReturnAddress?: string;
  resourceRecipes?: number;
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
    resourceChecksum: string;
    returnedToTranslatedAddress: boolean;
    usedTargetStack: boolean;
  };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native file-resource final jump", () => {
  it(
    "captures an arm64 regular file fd or reopens it after the translated amd64 return",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-file-resource-final-jump-test-"));
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
      const summary = JSON.parse(result.stdout) as NativeFileResourceFinalJumpSummary;
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
      expect(summary.regularFileFd).toBeGreaterThan(2);
      expect(summary.sourceResourcePath).toMatch(/native-file-resource\.txt$/);
      expect(summary.sourceResourceOffset).toBe(9);
      expect(summary.resourceChecksum).toBe("0x4d");
      if (summary.phase === "capture-source") {
        expect(process.arch).toBe("arm64");
        expect(summary.execution).toBe(
          "captured-arm64-source-awaiting-amd64-file-resource-final-jump",
        );
        expect(summary.sourceBundleDir).toBeTruthy();
        const bundle = validateNativeProcessImageBundle(summary.sourceBundleDir!);
        expect(
          bundle.resources.resources.some(
            (resource) =>
              resource.kind === "file" &&
              resource.fd === summary.regularFileFd &&
              resource.path?.endsWith("native-file-resource.txt"),
          ),
        ).toBe(true);
        return;
      }

      expect(summary.phase).toBe("file-resource-final-jump");
      expect(summary.translatedEntry).toBe("0x14000080");
      expect(summary.translatedResourcePath).toMatch(/native-file-resource\.txt$/);
      expect(summary.resourceRecipes).toBeGreaterThanOrEqual(1);
      expect(summary.execution).toBe(
        "captured-arm64-file-resource-reopened-after-native-amd64-ret",
      );
      expect(summary.resumeEvent).toMatchObject({
        status: "jumped",
        targetArch: "amd64",
        entry: "0x14000080",
        argument: "0x15000000",
        returnValue: "0x4d",
        storedMarker: "0x4e454e494843414d",
        returnMarker: "0x52455455524e4a50",
        resourceChecksum: "0x4d",
        returnedToTranslatedAddress: true,
        usedTargetStack: true,
      });
      expect(summary.resumeEvent?.returnAddress).toBe(summary.translatedReturnAddress);
      const bundle = validateNativeProcessImageBundle(summary.bundleDir!);
      expect(bundle.manifest.capture.sourceArch).toBe("arm64");
      expect(bundle.manifest.target.arch).toBe("amd64");
      expect(
        bundle.resources.resources.some(
          (resource) =>
            resource.kind === "file" &&
            resource.state === "recipe" &&
            resource.recipe?.reopen === summary.translatedResourcePath,
        ),
      ).toBe(true);
    },
  );
});
