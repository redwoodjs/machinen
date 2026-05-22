import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SCRIPT = join(REPO_ROOT, "scripts/native-target-vm-synthetic-continuation.ts");

describe("native target VM synthetic continuation script", () => {
  it("skips clearly when no target code file is provided", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "verify", "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 5 * 1024 * 1024,
    });

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout) as { skipped?: boolean; reason?: string };
    expect(summary.skipped).toBe(true);
    expect(summary.reason).toMatch(/Linux\/amd64 host|--code-file/);
  });
});
