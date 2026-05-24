import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SCRIPT = join(REPO_ROOT, "scripts/goal-task-automation.mjs");
const SCRIPT_ENV = { ...process.env, FORCE_COLOR: "1" };
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "goal-task-automation-"));
  tempDirs.push(dir);
  return dir;
}

function runGoalTask(args: string[]) {
  return spawnSync("node", [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: SCRIPT_ENV,
    timeout: 30_000,
  });
}

describe("goal task automation", () => {
  it("plans issue, branch, implementation, validation, push, and PR steps", () => {
    const dir = tempDir();
    const issueBody = join(dir, "issue.md");
    const validationLog = join(dir, "validation.json");
    writeFileSync(issueBody, "Issue body");

    const result = runGoalTask([
      "run",
      "--dry-run",
      "--json",
      "--title",
      "Automate one goal task",
      "--branch",
      "pp-test-goal-task",
      "--issue-body-file",
      issueBody,
      "--implementation-command",
      "node -e 'console.log(1)'",
      "--validation-profile",
      "focused",
      "--focused-vitest",
      "packages/runtime/src/__tests__/goal-task-automation.test.ts",
      "--validation-log",
      validationLog,
    ]);

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.state).toBe("planned");
    expect(summary.steps.map((step: { command: string }) => step.command)).toEqual([
      expect.stringContaining("gh issue create"),
      expect.stringContaining("git switch -c"),
      "node -e 'console.log(1)'",
      "git push -u origin HEAD",
      expect.stringContaining("gh pr create"),
    ]);
    const log = JSON.parse(readFileSync(validationLog, "utf8"));
    expect(log).toMatchObject({ state: "planned", validationProfile: "focused" });
    expect(log.commands.map((entry: { command: string }) => entry.command)).toContain(
      "NPM_CONFIG_USERCONFIG=/dev/null npx vitest run packages/runtime/src/__tests__/goal-task-automation.test.ts",
    );
  });

  it("plans the full VM validation gate set", () => {
    const dir = tempDir();
    const validationLog = join(dir, "vm-validation.json");
    const result = runGoalTask([
      "validate",
      "--dry-run",
      "--json",
      "--validation-profile",
      "vm",
      "--validation-log",
      validationLog,
    ]);

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.commands.map((entry: { command: string }) => entry.command)).toEqual([
      "pnpm run build:docs",
      "pnpm run format:check",
      "pnpm run lint",
      "pnpm run typecheck",
      "NPM_CONFIG_USERCONFIG=/dev/null npx vitest run",
      "pnpm smoke-tests",
      "pnpm exec fallow audit --changed-since origin/portable-snapshots",
    ]);
    expect(readFileSync(validationLog, "utf8")).toContain('"validationProfile": "vm"');
  });

  it("generates a reusable PR body from validation timings", () => {
    const dir = tempDir();
    const validationLog = join(dir, "validation.json");
    const bodyFile = join(dir, "pr.md");
    writeFileSync(
      validationLog,
      JSON.stringify({
        commands: [{ command: "pnpm run lint", status: "passed", elapsedMs: 1234 }],
      }),
    );

    const result = runGoalTask([
      "pr-body",
      "--json",
      "--problem",
      "A task needed a clear PR body.",
      "--solution",
      "The automation writes one.",
      "--validation-log",
      validationLog,
      "--body-file",
      bodyFile,
    ]);

    expect(result.status, result.stderr).toBe(0);
    const body = readFileSync(bodyFile, "utf8");
    expect(body).toContain("## Problem");
    expect(body).toContain("A task needed a clear PR body.");
    expect(body).toContain("`pnpm run lint` — passed (1.234s)");
  });

  it("marks a matching goal checkbox line complete", () => {
    const dir = tempDir();
    const goalFile = join(dir, "goal.md");
    writeFileSync(goalFile, "- [ ] Add reusable PR body generation\n- [ ] Other task\n");

    const result = runGoalTask([
      "update-goal",
      "--json",
      "--goal-file",
      goalFile,
      "--match",
      "Add reusable PR body generation",
    ]);

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({ state: "completed", line: 1 });
    expect(readFileSync(goalFile, "utf8")).toContain("- [x] Add reusable PR body generation");
  });

  it("plans manual closure of non-default-base issues", () => {
    const result = runGoalTask([
      "close-issue",
      "--dry-run",
      "--json",
      "--issue",
      "729",
      "--comment",
      "Completed in a portable-snapshots PR.",
    ]);

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({ state: "planned", issue: "729" });
    expect(summary.command.command).toContain("gh issue close");
  });
});
