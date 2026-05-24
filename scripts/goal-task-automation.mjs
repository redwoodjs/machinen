#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_BASE = "portable-snapshots";
const DEFAULT_GOAL = "goal.md";
const DEFAULT_LOG = "/tmp/machinen-goal-task-validation.json";
const CI_COMMAND =
  "AGENT_CI_DOCKER_HOST=unix:///Users/peterp/.orbstack/run/docker.sock NPM_CONFIG_USERCONFIG=/dev/null npx agent-ci run --all -q -p";

const VALUE_OPTIONS = new Map([
  ["--title", "title"],
  ["--issue-body-file", "issueBodyFile"],
  ["--branch", "branch"],
  ["--base", "base"],
  ["--implementation-command", "implementationCommand"],
  ["--validation-profile", "validationProfile"],
  ["--focused-vitest", "focusedVitest"],
  ["--problem", "problem"],
  ["--solution", "solution"],
  ["--validation-log", "validationLog"],
  ["--body-file", "bodyFile"],
  ["--goal-file", "goalFile"],
  ["--match", "match"],
  ["--status", "status"],
  ["--issue", "issue"],
  ["--comment", "comment"],
]);
const FLAG_OPTIONS = new Map([
  ["--dry-run", "dryRun"],
  ["--json", "json"],
  ["--include-ci", "includeCi"],
]);
const MULTI_VALUE_OPTIONS = new Set(["focusedVitest"]);

function usage(exitCode = 2) {
  console.error(
    [
      "usage: pnpm goal-task -- <command> [options]",
      "",
      "Commands:",
      "  run           Open issue, create branch, run implementation, validate, push, open PR",
      "  validate      Run or plan validation commands and write a timing log",
      "  pr-body       Generate a reusable PR body",
      "  update-goal   Mark a matching goal.md checkbox line complete",
      "  close-issue   Close a GitHub issue with a comment",
      "",
      "Common options:",
      "  --dry-run --json",
      "  --validation-log path",
      "",
      "Validation profiles:",
      "  docs      build docs, format, lint, typecheck, optional focused vitest, fallow",
      "  focused   format, lint, typecheck, focused vitest, fallow",
      "  vm        build docs, format, lint, typecheck, full vitest, smoke-tests, fallow",
      "  ci        Agent CI only",
      "  none      no validation",
    ].join("\n"),
  );
  process.exit(exitCode);
}

function defaultOptions() {
  const toggles = { dryRun: false, json: false, includeCi: false };
  return Object.assign(toggles, {
    base: DEFAULT_BASE,
    validationProfile: "docs",
    validationLog: DEFAULT_LOG,
    goalFile: DEFAULT_GOAL,
    status: "x",
    focusedVitest: [],
  });
}

function readValue(argv, index) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    usage();
  }
  return [value, index + 1];
}

// fallow-ignore-next-line complexity
function applyArg(options, argv, index) {
  const arg = argv[index];
  if (arg === "--help" || arg === "-h") {
    usage(0);
  }
  if (VALUE_OPTIONS.has(arg)) {
    const [value, next] = readValue(argv, index);
    const key = VALUE_OPTIONS.get(arg);
    if (MULTI_VALUE_OPTIONS.has(key)) {
      options[key].push(value);
    } else {
      options[key] = value;
    }
    return next;
  }
  if (FLAG_OPTIONS.has(arg)) {
    options[FLAG_OPTIONS.get(arg)] = true;
    return index;
  }
  usage();
}

// fallow-ignore-next-line complexity
function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    usage(argv.length === 0 ? 2 : 0);
  }
  const command = argv[0];
  const options = defaultOptions();
  for (let index = 1; index < argv.length; index += 1) {
    index = applyArg(options, argv, index);
  }
  return { command, options };
}

function now() {
  return new Date().toISOString();
}

function gitValue(args, fallback = "") {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : fallback;
}

// fallow-ignore-next-line complexity
function logContext(options) {
  return {
    startedAt: now(),
    branch: gitValue(["branch", "--show-current"], "unknown"),
    commit: gitValue(["rev-parse", "--short", "HEAD"], "unknown"),
    base: options.base,
    validationProfile: options.validationProfile,
    remotes: {
      arm64: process.env.PORTABLE_ARM64_SSH ?? "friend@100.126.46.90",
      amd64: process.env.PORTABLE_AMD64_SSH ?? "root@192.168.0.8",
      amd64Repo: process.env.PORTABLE_AMD64_REPO ?? "",
      sourceTarget: process.env.PORTABLE_MACHINE_REMOTE_SOURCE_TARGET ?? "",
    },
    paths: {
      validationLog: resolve(options.validationLog),
      goalFile: resolve(options.goalFile),
    },
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runCommand(command, options) {
  const started = Date.now();
  if (options.dryRun) {
    return { command, status: "planned", exitCode: 0, elapsedMs: 0 };
  }
  const result = spawnSync(command, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: true,
    stdio: "pipe",
  });
  return {
    command,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    elapsedMs: Date.now() - started,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

// fallow-ignore-next-line complexity
function validationCommands(options) {
  const focused = options.focusedVitest;
  const focusedVitest =
    focused.length > 0
      ? [`NPM_CONFIG_USERCONFIG=/dev/null npx vitest run ${focused.join(" ")}`]
      : [];
  const fallow = ["pnpm exec fallow audit --changed-since origin/portable-snapshots"];
  const profiles = {
    none: [],
    docs: [
      "pnpm run build:docs",
      "pnpm run format:check",
      "pnpm run lint",
      "pnpm run typecheck",
      ...focusedVitest,
      ...fallow,
    ],
    focused: [
      "pnpm run format:check",
      "pnpm run lint",
      "pnpm run typecheck",
      ...focusedVitest,
      ...fallow,
    ],
    vm: [
      "pnpm run build:docs",
      "pnpm run format:check",
      "pnpm run lint",
      "pnpm run typecheck",
      "NPM_CONFIG_USERCONFIG=/dev/null npx vitest run",
      "pnpm smoke-tests",
      ...fallow,
    ],
    ci: [CI_COMMAND],
  };
  const commands = profiles[options.validationProfile];
  if (!commands) {
    throw new Error(`unknown validation profile: ${options.validationProfile}`);
  }
  return options.includeCi && options.validationProfile !== "ci"
    ? [...commands, CI_COMMAND]
    : commands;
}

function validate(options) {
  const context = logContext(options);
  const commands = validationCommands(options);
  const results = commands.map((command) => runCommand(command, options));
  const failed = results.find((entry) => entry.status === "failed");
  const log = {
    ...context,
    completedAt: now(),
    state: failed ? "failed" : options.dryRun ? "planned" : "passed",
    commands: results,
  };
  writeJson(options.validationLog, log);
  return log;
}

function validationLines(log) {
  return (log.commands ?? []).map((entry) => {
    const elapsed = entry.elapsedMs === 0 ? "planned" : `${(entry.elapsedMs / 1000).toFixed(3)}s`;
    return `- \`${entry.command}\` — ${entry.status}${elapsed === "planned" ? "" : ` (${elapsed})`}`;
  });
}

// fallow-ignore-next-line complexity
function prBody(options) {
  const validationLog = options.validationLog && readFileSync(options.validationLog, "utf8");
  const log = validationLog ? JSON.parse(validationLog) : { commands: [] };
  const body = [
    "## Problem",
    "",
    options.problem ?? "This task was tracked in goal.md but did not have reusable automation yet.",
    "",
    "## Solution",
    "",
    options.solution ??
      "This change adds the requested automation and records validation output with timings.",
    "",
    "## Validation",
    "",
    ...validationLines(log),
    "",
  ].join("\n");
  if (options.bodyFile) {
    mkdirSync(dirname(resolve(options.bodyFile)), { recursive: true });
    writeFileSync(options.bodyFile, body);
  }
  return { state: "completed", body, bodyFile: options.bodyFile ?? "" };
}

function plannedOrRun(command, options, steps) {
  const result = runCommand(command, options);
  steps.push(result);
  if (result.status === "failed") {
    throw new Error(`command failed: ${command}`);
  }
  return result;
}

// fallow-ignore-next-line complexity
function runTask(options) {
  if (!options.title || !options.branch || !options.issueBodyFile) {
    throw new Error("run requires --title, --branch, and --issue-body-file");
  }
  const steps = [];
  plannedOrRun(
    `gh issue create --title ${JSON.stringify(options.title)} --body-file ${JSON.stringify(options.issueBodyFile)}`,
    options,
    steps,
  );
  plannedOrRun(`git switch -c ${JSON.stringify(options.branch)}`, options, steps);
  if (options.implementationCommand) {
    plannedOrRun(options.implementationCommand, options, steps);
  }
  const validation = validate(options);
  const bodyFile = options.bodyFile ?? `/tmp/machinen-pr-${options.branch}.md`;
  const body = prBody({ ...options, bodyFile });
  plannedOrRun("git push -u origin HEAD", options, steps);
  plannedOrRun(
    `gh pr create --base ${JSON.stringify(options.base)} --head ${JSON.stringify(options.branch)} --title ${JSON.stringify(options.title)} --body-file ${JSON.stringify(bodyFile)}`,
    options,
    steps,
  );
  return { state: options.dryRun ? "planned" : "completed", steps, validation, prBody: body };
}

// fallow-ignore-next-line complexity
function updateGoal(options) {
  if (!options.match) {
    throw new Error("update-goal requires --match");
  }
  const goalPath = options.goalFile;
  const text = readFileSync(goalPath, "utf8");
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.includes(options.match) && /\[[ x~!]\]/.test(line));
  if (index < 0) {
    throw new Error(`no matching goal checkbox line for: ${options.match}`);
  }
  const updatedLine = lines[index].replace(/\[[ x~!]\]/, `[${options.status}]`);
  if (!options.dryRun) {
    lines[index] = updatedLine;
    writeFileSync(goalPath, lines.join("\n"));
  }
  return {
    state: options.dryRun ? "planned" : "completed",
    goalFile: goalPath,
    line: index + 1,
    before: lines[index],
    after: updatedLine,
  };
}

function closeIssue(options) {
  if (!options.issue) {
    throw new Error("close-issue requires --issue");
  }
  const comment = options.comment ?? "Completed on portable-snapshots.";
  const result = runCommand(
    `gh issue close ${JSON.stringify(options.issue)} --comment ${JSON.stringify(comment)}`,
    options,
  );
  return {
    state: options.dryRun ? "planned" : result.status,
    issue: options.issue,
    command: result,
  };
}

// fallow-ignore-next-line complexity
function print(value, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  console.log(
    `${value.state}: ${value.command ?? value.validationProfile ?? value.issue ?? value.goalFile ?? "goal-task"}`,
  );
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const handlers = {
    run: runTask,
    validate,
    "pr-body": prBody,
    "update-goal": updateGoal,
    "close-issue": closeIssue,
  };
  const handler = handlers[command];
  if (!handler) {
    usage();
  }
  const result = handler(options);
  print(result, options.json);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
