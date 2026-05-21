import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-real-utility-target-unwind.ts");
const TMP: string[] = [];

interface NativeRealUtilityTargetUnwindSummary {
  phase?: string;
  targetAddress?: string;
  targetRule?: { metadata: string; cfa: { register: string }; returnAddress: { offset: number } };
  targetUnwind?: { matches: Array<{ preservesReturnContract: boolean }>; refusals: unknown[] };
  plan?: { state: string; blockingBoundary: string; attemptedResume: boolean };
  sourceTextReusedAsTargetCode?: boolean;
  execution?: string;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native real utility target unwind proof", () => {
  it("matches source eh_frame frames to target amd64 unwind metadata", () => {
    const outDir = mkdtempSync(join(tmpdir(), "native-real-utility-target-unwind-test-"));
    TMP.push(outDir);

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
      { encoding: "utf8", cwd: REPO_ROOT, env: process.env, maxBuffer: 20 * 1024 * 1024 },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout) as NativeRealUtilityTargetUnwindSummary;

    expect(summary.phase).toBe("real-utility-target-unwind");
    expect(summary.targetAddress).toMatch(/^0x[0-9a-f]+$/);
    expect(summary.targetRule).toMatchObject({
      metadata: "eh-frame",
      cfa: { register: "rbp" },
      returnAddress: { offset: -8 },
    });
    expect(summary.targetUnwind?.refusals).toEqual([]);
    expect(summary.targetUnwind?.matches[0]).toMatchObject({ preservesReturnContract: true });
    expect(summary.plan).toMatchObject({
      state: "ready",
      blockingBoundary: "ready",
      attemptedResume: false,
    });
    expect(summary.sourceTextReusedAsTargetCode).toBe(false);
    expect(summary.execution).toBe("real-utility-target-unwind-matched-by-amd64-eh-frame");
  });
});
