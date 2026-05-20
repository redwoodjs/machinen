import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validatePortableSnapshotBundle } from "../vm/portable-snapshot.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/continuation-translate.mjs");
const TMP: string[] = [];

interface ContinuationSummary {
  skipped?: boolean;
  hostArch: string;
  bundleDir: string;
  continuation: {
    id: string;
    restoreEntrypoint: string;
    requiredLiveValues: string[];
    rawStackCopied: boolean;
    liveValues: Array<{ name: string; value: number | string; source: string }>;
  };
  semanticState: {
    id: string;
    rawStackCopied: boolean;
    seed: number;
    liveLocal: number;
    resumeDelta: number;
    checksumHex: string;
    result: number;
    liveValues: Array<{ name: string; value: number | string; source: string }>;
  };
  missingValueRefusal: { code: string; message: string; detail: { missing: string[] } };
  restoreEvent: {
    fixture: string;
    continuation: string;
    seed: number;
    live_local: number;
    resume_delta: number;
    checksum_hex: string;
    result: number;
    resumed: boolean;
  };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("continuation translation", () => {
  it.skipIf(process.platform !== "linux")(
    "restores a nested controlled continuation without copying the raw source stack",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "continuation-translate-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        [VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as ContinuationSummary;
      expect(summary.skipped).not.toBe(true);
      expect(summary.hostArch).toMatch(/^(arm64|amd64)$/);
      expect(summary.continuation).toMatchObject({
        id: "controlled_continuation_point",
        restoreEntrypoint: "machinen_controlled_continuation_restore",
        rawStackCopied: false,
      });
      expect(summary.continuation.requiredLiveValues).toEqual([
        "continuation",
        "seed",
        "live_local",
        "resume_delta",
        "checksum",
      ]);
      expect(summary.semanticState).toMatchObject({
        id: "controlled_continuation_point",
        rawStackCopied: false,
        seed: 1000,
        liveLocal: 5242,
        resumeDelta: 77,
        result: 5319,
      });
      expect(summary.semanticState.liveValues.map((value) => value.name)).toEqual([
        "seed",
        "live_local",
        "resume_delta",
        "checksum",
      ]);
      expect(
        summary.semanticState.liveValues.every((value) => value.source === "stack-frame-field"),
      ).toBe(true);
      expect(summary.missingValueRefusal).toMatchObject({
        code: "continuation-live-value-missing",
        detail: { missing: ["live_local"] },
      });
      expect(summary.restoreEvent).toMatchObject({
        fixture: "continuation-restore",
        continuation: summary.semanticState.id,
        seed: summary.semanticState.seed,
        live_local: summary.semanticState.liveLocal,
        resume_delta: summary.semanticState.resumeDelta,
        result: summary.semanticState.result,
        resumed: true,
      });
      expect(summary.restoreEvent.checksum_hex).toBe(summary.semanticState.checksumHex);

      const bundle = validatePortableSnapshotBundle(summary.bundleDir);
      expect(bundle.manifest.features).toContain("continuation-translation");
      expect(bundle.objects.objects.map((object) => object.id)).toEqual([
        "controlled-continuation-frame",
        "controlled-continuation-live-values",
      ]);
      expect(bundle.objects.objects[0]).not.toHaveProperty("memory");
      expect(bundle.relocations.relocations).toHaveLength(0);
    },
  );
});
