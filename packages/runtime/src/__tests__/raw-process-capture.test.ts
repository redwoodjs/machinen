import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/raw-process-capture.mjs");
const TMP: string[] = [];

interface RawCaptureSummary {
  skipped?: boolean;
  hostArch: string;
  captures: Array<{
    name: string;
    threadCount: number;
    mapCount: number;
    fdCount: number;
    registerBytes: number[];
    resourceFdCaptured?: boolean;
    recoveredState: unknown;
  }>;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("raw process capture", () => {
  it.skipIf(process.platform !== "linux")(
    "captures registers maps memory symbols and fds from an unmodified stopped process",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "raw-process-capture-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        [VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as RawCaptureSummary;
      expect(summary.skipped).not.toBe(true);
      expect(summary.hostArch).toMatch(/^(arm64|amd64)$/);
      expect(summary.captures.map((capture) => capture.name)).toEqual([
        "global",
        "resource",
        "threads",
      ]);
      expect(summary.captures.every((capture) => capture.mapCount > 0)).toBe(true);
      expect(summary.captures.every((capture) => capture.fdCount > 0)).toBe(true);
      expect(
        summary.captures.every((capture) => capture.registerBytes.every((size) => size > 0)),
      ).toBe(true);
      expect(summary.captures.find((capture) => capture.name === "resource")).toMatchObject({
        resourceFdCaptured: true,
      });
      expect(
        summary.captures.find((capture) => capture.name === "threads")?.threadCount,
      ).toBeGreaterThanOrEqual(3);
    },
  );
});
