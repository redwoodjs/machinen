import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-mapping-policy.ts");
const TMP: string[] = [];

interface NativeMappingPolicySummary {
  skipped?: boolean;
  reason?: string;
  bundleDir?: string;
  mappingCount?: number;
  kernelRecreatedMappings?: Array<{
    kind: string;
    materialization: string;
    capturedBytes: number;
  }>;
  guardRecreatedMappings?: Array<{
    kind: string;
    materialization: string;
    capturedBytes: number;
  }>;
  mappingRefusals?: Array<{ code: string; message: string; detail?: Record<string, unknown> }>;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native mapping policy", () => {
  it(
    "recreates kernel and guard mappings without copying source bytes",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-mapping-policy-test-"));
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
      const summary = JSON.parse(result.stdout) as NativeMappingPolicySummary;
      if (summary.skipped) {
        expect(process.platform).not.toBe("linux");
        expect(summary.reason).toBeTruthy();
        return;
      }

      expect(summary.mappingCount).toBeGreaterThan(0);
      expect(summary.kernelRecreatedMappings?.length).toBeGreaterThan(0);
      expect(summary.kernelRecreatedMappings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ materialization: "recreate", capturedBytes: 0 }),
        ]),
      );
      expect(summary.guardRecreatedMappings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            materialization: "recreate",
            capturedBytes: 0,
          }),
        ]),
      );
      expect(
        summary.mappingRefusals?.every(
          (refusal) =>
            refusal.code !== "mapping-unreadable" ||
            (refusal.detail?.perms && refusal.detail.sourceStart && refusal.detail.sourceEnd),
        ),
      ).toBe(true);

      const bundle = validateNativeProcessImageBundle(summary.bundleDir!);
      expect(
        bundle.mappings.mappings.every(
          (mapping) =>
            mapping.target.materialization !== "recreate" || mapping.captured === undefined,
        ),
      ).toBe(true);
    },
  );
});
