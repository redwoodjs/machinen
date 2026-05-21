import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-real-utility-target-module-bytes.ts");
const TMP: string[] = [];

interface NativeRealUtilityTargetModuleBytesSummary {
  phase?: string;
  targetBytesSource?: string;
  materialized?: {
    moduleId: string;
    relativeStart: string;
    relativeEnd: string;
    sizeBytes: number;
    bytesSha256: string;
    sourceTextReusedAsTargetCode: boolean;
  };
  sourceTextReusedAsTargetCode?: boolean;
  execution?: string;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native real utility target module bytes proof", () => {
  it("materializes target-native bytes from explicit target inventory", () => {
    const outDir = mkdtempSync(join(tmpdir(), "native-real-utility-target-module-bytes-test-"));
    TMP.push(outDir);

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
      { encoding: "utf8", cwd: REPO_ROOT, env: process.env, maxBuffer: 20 * 1024 * 1024 },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout) as NativeRealUtilityTargetModuleBytesSummary;

    expect(summary.phase).toBe("real-utility-target-module-bytes");
    expect(summary.targetBytesSource).toBe("explicit-target-root");
    expect(summary.materialized).toMatchObject({
      moduleId: "target:realspin",
      relativeStart: "0x1200",
      relativeEnd: "0x1280",
      sizeBytes: 0x80,
      sourceTextReusedAsTargetCode: false,
    });
    expect(summary.materialized?.bytesSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.sourceTextReusedAsTargetCode).toBe(false);
    expect(summary.execution).toBe(
      "real-utility-target-module-bytes-materialized-from-explicit-target-root",
    );
  });
});
