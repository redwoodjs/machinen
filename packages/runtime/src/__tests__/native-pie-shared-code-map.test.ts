import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-pie-shared-code-map.ts");
const TMP: string[] = [];

interface NativePieSharedCodeMapSummary {
  skipped?: boolean;
  reason?: string;
  hostArch?: string;
  targetArch?: string;
  bundleDir?: string;
  sourcePc?: string;
  symbol?: string;
  sourceSymbolRelativeAddress?: string;
  sourceModule?: { loadBias: string; kind: string; textMapping: string };
  targetModule?: { loadBias: string; kind: string; textMapping: string };
  pieExecutableMapping?: { path?: string; materialization: string };
  sharedLibraryMapping?: { path?: string; materialization: string };
  mappedLocation?: { state: string; sourceAddress: string; targetAddress: string };
  mismatchRefusal?: { code: string };
  aslrIndependent?: boolean;
  execution?: string;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native PIE/shared-library code map", () => {
  it(
    "maps captured shared-library PCs by module-relative address instead of raw VA",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-pie-shared-code-map-test-"));
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
      const summary = JSON.parse(result.stdout) as NativePieSharedCodeMapSummary;
      if (summary.skipped) {
        expect(process.platform !== "linux" || !["arm64", "x64"].includes(process.arch)).toBe(true);
        expect(summary.reason).toBeTruthy();
        return;
      }

      expect(summary.hostArch).toMatch(/^(arm64|amd64)$/);
      expect(summary.targetArch).toMatch(/^(arm64|amd64)$/);
      expect(summary.sourcePc).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.symbol).toBe("machinen_native_pie_shared_spin");
      expect(summary.sourceSymbolRelativeAddress).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.sourceModule).toMatchObject({ kind: "shared-object" });
      expect(summary.targetModule).toMatchObject({ kind: "shared-object" });
      expect(summary.sourceModule?.loadBias).not.toBe(summary.targetModule?.loadBias);
      expect(summary.pieExecutableMapping?.path).toContain("machinen-native-pie-shared-main");
      expect(summary.sharedLibraryMapping?.path).toContain("libmachinen-native-pie-shared.so");
      expect(summary.mappedLocation).toMatchObject({ state: "mapped" });
      expect(summary.mappedLocation?.sourceAddress).toBe(summary.sourcePc);
      expect(summary.mappedLocation?.targetAddress).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.mappedLocation?.targetAddress).not.toBe(summary.mappedLocation?.sourceAddress);
      expect(summary.mismatchRefusal?.code).toBe("target-build-mismatch");
      expect(summary.aslrIndependent).toBe(true);
      expect(summary.execution).toBe(
        "captured-pie-shared-library-pc-mapped-by-module-relative-address",
      );
      validateNativeProcessImageBundle(summary.bundleDir!);
    },
  );
});
