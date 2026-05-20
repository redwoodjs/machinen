import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-restore-loader.mjs");
const TMP: string[] = [];

interface NativeRestoreLoaderSummary {
  hostArch: string;
  bundleDir: string;
  materializedMapping: string;
  restoreEvent: { status: string; sizeBytes: number; finalProt: string };
  missingMemoryRefusal: { status: number; stderr: string };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native restore loader", () => {
  it(
    "materializes a target mapping from a synthetic native process image",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-restore-loader-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        [VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as NativeRestoreLoaderSummary;
      expect(summary.hostArch).toMatch(/^(arm64|amd64)$/);
      expect(summary.materializedMapping).toBe("mapping:synthetic-stack");
      expect(summary.restoreEvent).toMatchObject({
        status: "materialized",
        sizeBytes: 4096,
        finalProt: "r",
      });
      expect(summary.missingMemoryRefusal.status).not.toBe(0);
      expect(summary.missingMemoryRefusal.stderr).toMatch(/open memory failed/);

      const bundle = validateNativeProcessImageBundle(join(outDir, "bundle"));
      expect(bundle.mappings.mappings[0]?.target.materialization).toBe("translate");
      expect(bundle.translation.threads[0]?.state).toBe("pending");
    },
  );
});
