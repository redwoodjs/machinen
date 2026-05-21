import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-dwarf-unwind-frames.ts");
const SOURCE_BUNDLE_ENV = "MACHINEN_NATIVE_DWARF_UNWIND_SOURCE_BUNDLE";
const TMP: string[] = [];

interface NativeDwarfUnwindFramesSummary {
  skipped?: boolean;
  reason?: string;
  phase?: "capture-source" | "dwarf-unwind-final-jump";
  sourceBundleDir?: string;
  bundleDir?: string;
  capturedSourcePc?: string;
  discoveredReturnAddress?: string;
  discoveredReturnAddressSlot?: string;
  cfa?: string;
  unwindRule?: {
    metadata: string;
    cfa: { register: string; offset: number };
    returnAddress: { location: string; offset?: number };
  };
  translatedReturnAddress?: string;
  stackRelocations?: number;
  execution?: string;
  resumeEvent?: { status: string; returnedToTranslatedAddress: boolean };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native DWARF unwind frames", () => {
  it(
    "captures an arm64 DWARF-discovered frame or returns through it on amd64",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-dwarf-unwind-frames-test-"));
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
      const summary = JSON.parse(result.stdout) as NativeDwarfUnwindFramesSummary;
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
      expect(summary.discoveredReturnAddress).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.discoveredReturnAddressSlot).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.cfa).toMatch(/^0x[0-9a-f]+$/);
      if (summary.phase === "capture-source") {
        expect(process.arch).toBe("arm64");
        expect(summary.unwindRule).toMatchObject({
          metadata: "eh-frame",
          cfa: { register: "x29" },
          returnAddress: { location: "cfa-relative" },
        });
        expect(summary.execution).toBe(
          "captured-arm64-source-frame-discovered-from-dwarf-unwind-metadata",
        );
        expect(summary.sourceBundleDir).toBeTruthy();
        expect(existsSync(join(summary.sourceBundleDir!, "native-unwind-frames.json"))).toBe(true);
        validateNativeProcessImageBundle(summary.sourceBundleDir!);
        return;
      }

      expect(summary.phase).toBe("dwarf-unwind-final-jump");
      expect(summary.translatedReturnAddress).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.stackRelocations).toBeGreaterThan(0);
      expect(summary.execution).toBe(
        "captured-arm64-source-returned-through-dwarf-discovered-amd64-frame",
      );
      expect(summary.resumeEvent).toMatchObject({
        status: "jumped",
        returnedToTranslatedAddress: true,
      });
      validateNativeProcessImageBundle(summary.bundleDir!);
    },
  );
});
