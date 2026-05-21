import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-real-utility-code-map.ts");
const TMP: string[] = [];

interface NativeRealUtilityCodeMapSummary {
  skipped?: boolean;
  reason?: string;
  hostArch?: string;
  targetArch?: string;
  bundleDir?: string;
  mappedLocation?: { state: string; sourceAddress: string; targetAddress: string };
  sourceRva?: string;
  targetAddress?: string;
  refusals?: Array<{ code: string }>;
  attemptedResume?: boolean;
  sourceTextReusedAsTargetCode?: boolean;
  targetBinarySource?: string;
  execution?: string;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native real utility code-map proof", () => {
  it("maps an outside-syscall real utility PC by target module/RVA", { timeout: 120_000 }, () => {
    const outDir = mkdtempSync(join(tmpdir(), "native-real-utility-code-map-test-"));
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
    const summary = JSON.parse(result.stdout) as NativeRealUtilityCodeMapSummary;
    if (summary.skipped) {
      expect(
        process.platform !== "linux" || process.arch !== "arm64" || summary.reason,
      ).toBeTruthy();
      return;
    }

    expect(summary.hostArch).toBe("arm64");
    expect(summary.targetArch).toBe("amd64");
    expect(summary.mappedLocation).toMatchObject({ state: "mapped" });
    expect(summary.mappedLocation?.sourceAddress).toMatch(/^0x[0-9a-f]+$/);
    expect(summary.mappedLocation?.targetAddress).toMatch(/^0x[0-9a-f]+$/);
    expect(summary.mappedLocation?.targetAddress).not.toBe(summary.mappedLocation?.sourceAddress);
    expect(summary.sourceRva).toMatch(/^0x[0-9a-f]+$/);
    expect(summary.targetAddress).toBe(summary.mappedLocation?.targetAddress);
    expect(summary.refusals).toEqual([]);
    expect(summary.attemptedResume).toBe(false);
    expect(summary.sourceTextReusedAsTargetCode).toBe(false);
    expect(summary.targetBinarySource).toBe("explicit-module-inventory");
    expect(summary.execution).toBe("real-arm64-utility-pc-mapped-to-amd64-module-rva");
    validateNativeProcessImageBundle(summary.bundleDir!);
  });
});
