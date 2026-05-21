import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-real-utility-continuation.ts");
const TMP: string[] = [];

interface NativeRealUtilityContinuationSummary {
  skipped?: boolean;
  reason?: string;
  phase?: string;
  codeLocations?: Array<{ state: string; targetAddress?: string }>;
  resourceRecipes?: Array<{ id: string; recipe: Record<string, unknown> }>;
  sourceFrames?: Array<{ metadata: string; returnAddressSlot?: string }>;
  plan?: {
    state: string;
    blockingBoundary: string;
    blockingRefusal?: { code: string };
    attemptedResume: boolean;
    sourceTextReusedAsTargetCode: boolean;
    sourceIsaEmulationUsed: boolean;
    sidecarRuntimeUsed: boolean;
  };
  attemptedResume?: boolean;
  sourceTextReusedAsTargetCode?: boolean;
  sourceIsaEmulationUsed?: boolean;
  sidecarRuntimeUsed?: boolean;
  execution?: string;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native real utility continuation proof", () => {
  it("reaches the first remaining target-native unwind boundary", () => {
    const outDir = mkdtempSync(join(tmpdir(), "native-real-utility-continuation-test-"));
    TMP.push(outDir);

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
      { encoding: "utf8", cwd: REPO_ROOT, env: process.env, maxBuffer: 20 * 1024 * 1024 },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout) as NativeRealUtilityContinuationSummary;
    if (summary.skipped) {
      expect(process.platform !== "linux").toBe(true);
      expect(summary.reason).toBeTruthy();
      return;
    }

    expect(summary.phase).toBe("native-real-utility-continuation");
    expect(summary.codeLocations?.[0]).toMatchObject({ state: "mapped" });
    expect(summary.codeLocations?.[0]?.targetAddress).toMatch(/^0x[0-9a-f]+$/);
    expect(summary.resourceRecipes?.map((recipe) => recipe.id)).toEqual(["fd:1", "fd:2", "fd:3"]);
    expect(summary.sourceFrames?.[0]).toMatchObject({ metadata: "eh-frame" });
    expect(summary.plan).toMatchObject({
      state: "refused",
      blockingBoundary: "target-unwind",
      blockingRefusal: { code: "target-unwind-mismatch" },
      attemptedResume: false,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    });
    expect(summary.attemptedResume).toBe(false);
    expect(summary.sourceTextReusedAsTargetCode).toBe(false);
    expect(summary.sourceIsaEmulationUsed).toBe(false);
    expect(summary.sidecarRuntimeUsed).toBe(false);
    expect(summary.execution).toBe(
      "real-utility-native-continuation-refused-at-target-unwind-mismatch",
    );
  });
});
