import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const PROFILE_SCRIPT = join(REPO_ROOT, "scripts/validation-profile.mjs");
const TMP: string[] = [];

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("validation profile script", () => {
  it("writes dry-run JSON and Markdown reports for selected steps", () => {
    const outDir = mkdtempSync(join(tmpdir(), "machinen-validation-profile-test-"));
    TMP.push(outDir);

    const result = spawnSync(
      process.execPath,
      [
        PROFILE_SCRIPT,
        "--dry-run",
        "--step",
        "format:check",
        "--step",
        "lint",
        "--out-dir",
        outDir,
        "--no-agent-ci-logs",
        "--json",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as {
      dryRun: boolean;
      status: string;
      steps: Array<{ name: string; status: string; durationMs: number }>;
      outputs: { jsonPath: string; latestMdPath: string };
    };

    expect(report).toMatchObject({ dryRun: true, status: "succeeded" });
    expect(report.steps).toMatchObject([
      { name: "format:check", status: "dry-run", durationMs: 0 },
      { name: "lint", status: "dry-run", durationMs: 0 },
    ]);
    expect(existsSync(report.outputs.jsonPath)).toBe(true);
    expect(existsSync(report.outputs.latestMdPath)).toBe(true);
    expect(readFileSync(report.outputs.latestMdPath, "utf8")).toContain("# Validation Profile");
  });

  it("lists built-in profiles without running validation", () => {
    const result = spawnSync(process.execPath, [PROFILE_SCRIPT, "--list"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("quick: format:check, lint");
    expect(result.stdout).toContain("agent-ci: npx agent-ci run --all -q -p");
  });
});
