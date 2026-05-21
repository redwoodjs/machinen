import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-nonfile-resource-boundary.ts");
const TMP: string[] = [];

interface NativeNonfileResourceBoundarySummary {
  skipped?: boolean;
  reason?: string;
  phase?: string;
  regularFileRecipe?: { reopen?: string; offset?: number; flags?: string[] };
  nonFileKinds?: string[];
  refusalCodes?: string[];
  execution?: string;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native non-file resource boundary", () => {
  it.skipIf(process.platform !== "linux")(
    "keeps regular file recipes while refusing non-file kernel resources precisely",
    { timeout: 180_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-nonfile-resource-boundary-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as NativeNonfileResourceBoundarySummary;
      if (summary.skipped) {
        expect(summary.reason).toMatch(/arm64 source side|unsupported host architecture/);
        return;
      }

      expect(summary.phase).toBe("nonfile-resource-boundary");
      expect(summary.regularFileRecipe?.reopen).toContain("native-nonfile-resource-boundary.txt");
      expect(summary.nonFileKinds).toEqual(
        expect.arrayContaining(["eventfd", "epoll", "pipe", "socket", "timer"]),
      );
      expect(summary.refusalCodes).toEqual(expect.arrayContaining(["kernel-state-unsupported"]));
      expect(summary.execution).toBe(
        "captured-regular-file-coexists-with-precise-nonfile-resource-refusals",
      );
    },
  );
});
