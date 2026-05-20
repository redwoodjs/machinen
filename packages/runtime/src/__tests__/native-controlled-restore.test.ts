import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-controlled-restore.ts");
const TMP: string[] = [];

interface NativeControlledRestoreSummary {
  bundleDir: string;
  codeLocations: number;
  registerThreads: number;
  stackRelocations: number;
  memoryRelocations: number;
  resourceRecipes: number;
  loaderEvent: { status: string; sizeBytes: number };
  refusal: { code: string };
  execution: string;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native controlled restore", () => {
  it(
    "materializes a translated controlled native image and records remaining boundary",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-controlled-restore-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", cwd: REPO_ROOT, maxBuffer: 20 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as NativeControlledRestoreSummary;
      expect(summary.codeLocations).toBe(1);
      expect(summary.registerThreads).toBe(1);
      expect(summary.stackRelocations).toBe(2);
      expect(summary.memoryRelocations).toBe(1);
      expect(summary.resourceRecipes).toBe(1);
      expect(summary.loaderEvent).toMatchObject({ status: "materialized", sizeBytes: 4096 });
      expect(summary.refusal.code).toBe("mapping-ambiguous");
      expect(summary.execution).toBe("materialized-translated-state-without-final-jump");

      const bundle = validateNativeProcessImageBundle(join(outDir, "bundle"));
      expect(bundle.translation.threads[0]?.state).toBe("translated");
      expect(bundle.translation.memoryRelocations).toHaveLength(3);
    },
  );
});
