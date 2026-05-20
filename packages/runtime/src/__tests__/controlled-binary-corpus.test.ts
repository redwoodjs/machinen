import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/controlled-binary-corpus.mjs");
const TMP: string[] = [];

interface ControlledSummary {
  native: {
    arch: string;
    events: Array<Record<string, unknown>>;
  };
  crossBuilds: Array<{ arch: string; triple: string; bytes: number }>;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("controlled binary corpus", () => {
  it("builds deterministic fixtures natively and for both Linux ISAs", { timeout: 120_000 }, () => {
    const outDir = mkdtempSync(join(tmpdir(), "controlled-binary-corpus-test-"));
    TMP.push(outDir);

    const result = spawnSync(
      process.execPath,
      [VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout) as ControlledSummary;

    expect(summary.native.arch).toMatch(/^(arm64|amd64)$/);
    expect(summary.native.events.map((event) => event.fixture)).toEqual([
      "global",
      "heap",
      "stack",
      "resource",
      "threads",
    ]);
    expect(summary.native.events.find((event) => event.fixture === "stack")).toMatchObject({
      continuation: "controlled_nested_stack_point",
      live_local: 5242,
    });
    expect(summary.crossBuilds.map((build) => build.arch)).toEqual(["arm64", "amd64"]);
    expect(summary.crossBuilds.every((build) => build.bytes > 0)).toBe(true);
  });
});
