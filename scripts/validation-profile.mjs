#!/usr/bin/env node
/** Time validation steps and write durable reports. */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUT_DIR = ".validation-runs";
const AGENT_CI_LOG_ROOT = join(homedir(), "Library/Application Support/agent-ci/logs");

const STEP_DEFINITIONS = {
  "format:check": {
    command: "pnpm",
    args: ["run", "format:check"],
    description: "Check formatting",
  },
  lint: {
    command: "pnpm",
    args: ["run", "lint"],
    description: "Run oxlint",
  },
  "build:docs": {
    command: "pnpm",
    args: ["run", "build:docs"],
    description: "Regenerate API docs",
  },
  typecheck: {
    command: "pnpm",
    args: ["run", "typecheck"],
    description: "Run TypeScript typecheck",
  },
  vitest: {
    command: "npx",
    args: ["vitest", "run"],
    env: { NPM_CONFIG_USERCONFIG: "/dev/null" },
    description: "Run unit tests",
  },
  fallow: {
    command: "pnpm",
    args: ["exec", "fallow", "audit", "--changed-since", "origin/main"],
    description: "Run changed-file fallow audit",
  },
  "generic-resource-graph-coverage": {
    command: "pnpm",
    args: ["run", "generic-resource-graph-coverage"],
    description: "Check generic resource graph proof inventory coverage",
  },
  "check-smoke-manifest": {
    command: "pnpm",
    args: ["run", "check-smoke-manifest"],
    description: "Check smoke manifest and matrix inventory drift",
  },
  "smoke-tests": {
    command: "pnpm",
    args: ["smoke-tests"],
    description: "Run VM smoke tests",
  },
  "agent-ci": {
    command: "npx",
    args: ["agent-ci", "run", "--all", "-q", "-p"],
    env: { NPM_CONFIG_USERCONFIG: "/dev/null" },
    description: "Run Agent CI workflows",
  },
};

const PROFILES = {
  quick: ["format:check", "lint", "build:docs", "typecheck", "vitest", "fallow"],
  "move-envelope-normal": [
    "format:check",
    "lint",
    "build:docs",
    "typecheck",
    "generic-resource-graph-coverage",
    "check-smoke-manifest",
    "fallow",
  ],
  required: ["format:check", "lint", "build:docs", "typecheck", "vitest", "fallow", "smoke-tests"],
  full: [
    "format:check",
    "lint",
    "build:docs",
    "typecheck",
    "vitest",
    "fallow",
    "smoke-tests",
    "agent-ci",
  ],
};

// fallow-ignore-next-line complexity
export function parseValidationProfileArgs(argv) {
  const options = {
    profile: "quick",
    steps: [],
    outDir: DEFAULT_OUT_DIR,
    dryRun: false,
    keepGoing: false,
    write: true,
    json: false,
    agentCiLogs: true,
    agentCiLogLimit: 6,
    list: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--keep-going") {
      options.keepGoing = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--no-write") {
      options.write = false;
    } else if (arg === "--no-agent-ci-logs") {
      options.agentCiLogs = false;
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--profile") {
      options.profile = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--step") {
      options.steps.push(requiredValue(argv, (index += 1), arg));
    } else if (arg === "--out-dir") {
      options.outDir = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--agent-ci-log-limit") {
      options.agentCiLogLimit = Number(requiredValue(argv, (index += 1), arg));
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

// fallow-ignore-next-line complexity
export async function runValidationProfile(options = {}) {
  const resolved = normalizeOptions(options);
  const stepNames = resolved.steps.length > 0 ? resolved.steps : PROFILES[resolved.profile];
  assertKnownSteps(stepNames);

  const startedAt = new Date();
  const steps = [];
  let failed = false;
  for (const name of stepNames) {
    const step = await runValidationStep(name, STEP_DEFINITIONS[name], resolved.dryRun);
    steps.push(step);
    if (step.status === "failed") {
      failed = true;
      if (!resolved.keepGoing) {
        break;
      }
    }
  }

  const finishedAt = new Date();
  const report = {
    version: 1,
    generatedAt: finishedAt.toISOString(),
    cwd: process.cwd(),
    git: gitInfo(),
    profile: resolved.profile,
    requestedSteps: stepNames,
    dryRun: resolved.dryRun,
    keepGoing: resolved.keepGoing,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    status: failed ? "failed" : "succeeded",
    steps,
    totals: summarizeSteps(steps),
    agentCiRecent: resolved.agentCiLogs
      ? readRecentAgentCiTimelines(AGENT_CI_LOG_ROOT, resolved.agentCiLogLimit)
      : [],
    cacheHints: validationCacheHints(),
  };

  if (resolved.write) {
    report.outputs = writeValidationReport(report, resolved.outDir);
  }
  return report;
}

export function readRecentAgentCiTimelines(logRoot = AGENT_CI_LOG_ROOT, limit = 6) {
  if (!existsSync(logRoot)) {
    return [];
  }
  return readdirSync(logRoot)
    .filter((entry) => entry.startsWith("agent-ci-") && entry.includes("-j"))
    .map((entry) => join(logRoot, entry))
    .filter((dir) => existsSync(join(dir, "timeline.json")))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    .slice(0, limit)
    .flatMap((dir) => parseAgentCiTimeline(dir));
}

// fallow-ignore-next-line complexity
export function parseAgentCiTimeline(dir) {
  const metadata = readJsonIfExists(join(dir, "metadata.json"));
  const timeline = readJsonIfExists(join(dir, "timeline.json"));
  if (!Array.isArray(timeline)) {
    return [];
  }
  const job = timeline.find((entry) => entry.type === "Job");
  const tasks = timeline
    .filter((entry) => entry.type === "Task")
    .map((task) => ({
      name: String(task.name),
      result: task.result ?? task.state ?? "unknown",
      durationMs: durationBetween(task.startTime, task.finishTime),
    }))
    .sort((left, right) => right.durationMs - left.durationMs);
  return [
    {
      runner: dirname(dir).endsWith("logs") ? dir.split("/").at(-1) : dir,
      workflowName: metadata?.workflowName,
      jobName: metadata?.jobName,
      result: job?.result ?? job?.state ?? "unknown",
      durationMs: durationBetween(job?.startTime, job?.finishTime),
      slowestTasks: tasks.slice(0, 8),
    },
  ];
}

// fallow-ignore-next-line complexity
export function renderValidationReportMarkdown(report) {
  const lines = [
    "# Validation Profile",
    "",
    `Generated: ${report.generatedAt}`,
    `Branch: ${report.git.branch ?? "unknown"}`,
    `Commit: ${report.git.commit ?? "unknown"}`,
    `Profile: ${report.profile}`,
    `Status: ${report.status}`,
    `Total: ${formatDuration(report.durationMs)}`,
    "",
    "## Steps",
    "",
    "| Step | Status | Duration | Command |",
    "| --- | --- | ---: | --- |",
    ...report.steps.map(
      (step) =>
        `| ${step.name} | ${step.status} | ${formatDuration(step.durationMs)} | \`${step.commandLine}\` |`,
    ),
    "",
    "## Slowest Agent CI tasks",
    "",
  ];

  if (report.agentCiRecent.length === 0) {
    lines.push("No Agent CI timelines were found.", "");
  } else {
    lines.push(
      "| Runner | Workflow | Job | Result | Duration | Slowest tasks |",
      "| --- | --- | --- | --- | ---: | --- |",
    );
    for (const ci of report.agentCiRecent) {
      lines.push(
        `| ${ci.runner} | ${ci.workflowName ?? ""} | ${ci.jobName ?? ""} | ${ci.result} | ${formatDuration(ci.durationMs)} | ${ci.slowestTasks
          .slice(0, 3)
          .map((task) => `${task.name} (${formatDuration(task.durationMs)})`)
          .join("<br>")} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Cache hints", "", ...report.cacheHints.map((hint) => `- ${hint}`), "");
  return `${lines.join("\n")}\n`;
}

// fallow-ignore-next-line complexity
function normalizeOptions(options) {
  const profile = options.profile ?? "quick";
  if (!PROFILES[profile]) {
    throw new Error(`unknown profile: ${profile}`);
  }
  return {
    profile,
    steps: options.steps ?? [],
    outDir: options.outDir ?? DEFAULT_OUT_DIR,
    dryRun: Boolean(options.dryRun),
    keepGoing: Boolean(options.keepGoing),
    write: options.write !== false,
    agentCiLogs: options.agentCiLogs !== false,
    agentCiLogLimit: Number.isFinite(options.agentCiLogLimit) ? options.agentCiLogLimit : 6,
  };
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function assertKnownSteps(stepNames) {
  for (const name of stepNames) {
    if (!STEP_DEFINITIONS[name]) {
      throw new Error(`unknown validation step: ${name}`);
    }
  }
}

function runValidationStep(name, definition, dryRun) {
  const startedAt = new Date();
  const commandLine = [definition.command, ...definition.args].join(" ");
  if (dryRun) {
    return Promise.resolve({
      name,
      description: definition.description,
      commandLine,
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      durationMs: 0,
      exitCode: 0,
      status: "dry-run",
    });
  }

  return new Promise((resolveStep) => {
    const child = spawn(definition.command, definition.args, {
      stdio: "inherit",
      env: { ...process.env, ...definition.env },
    });
    child.on("close", (exitCode) => {
      const finishedAt = new Date();
      resolveStep({
        name,
        description: definition.description,
        commandLine,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        exitCode,
        status: exitCode === 0 ? "succeeded" : "failed",
      });
    });
  });
}

function summarizeSteps(steps) {
  return {
    durationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
    succeeded: steps.filter((step) => step.status === "succeeded").length,
    failed: steps.filter((step) => step.status === "failed").length,
    dryRun: steps.filter((step) => step.status === "dry-run").length,
  };
}

function writeValidationReport(report, outDir) {
  const absoluteOutDir = resolve(outDir);
  mkdirSync(absoluteOutDir, { recursive: true });
  const stem = report.generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  const jsonPath = join(absoluteOutDir, `${stem}.json`);
  const mdPath = join(absoluteOutDir, `${stem}.md`);
  const latestMdPath = join(absoluteOutDir, "latest.md");
  const markdown = renderValidationReportMarkdown(report);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, markdown);
  writeFileSync(latestMdPath, markdown);
  return { jsonPath, mdPath, latestMdPath };
}

function gitInfo() {
  return {
    branch: gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: gitOutput(["rev-parse", "--short", "HEAD"]),
    main: gitOutput(["rev-parse", "--short", "origin/main"]),
  };
}

function gitOutput(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function durationBetween(start, finish) {
  const startMs = parseAgentCiTime(start);
  const finishMs = parseAgentCiTime(finish);
  return startMs && finishMs && finishMs >= startMs ? finishMs - startMs : 0;
}

function parseAgentCiTime(value) {
  if (!value || value.startsWith("0001-")) {
    return undefined;
  }
  return Date.parse(value.replace(/\.(\d{3})\d*Z$/, ".$1Z"));
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return "0ms";
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function validationCacheHints() {
  return [
    "Mount a persistent Corepack cache into proof containers: -v /tmp/machinen-corepack:/corepack -e COREPACK_HOME=/corepack.",
    "Mount a persistent pnpm store into proof containers: -v /tmp/machinen-pnpm-store:/pnpm-store -e MACHINEN_PNPM_STORE_DIR=/pnpm-store.",
    "Run bash scripts/proof-container-install.sh inside remote proof containers instead of repeating an uncached pnpm install.",
  ];
}

function printHelp() {
  console.log(
    `Usage: pnpm validation:profile [options]\n\nOptions:\n  --profile quick|move-envelope-normal|required|full\n                                  Built-in step set (default: quick)\n  --step <name>                  Run one named step; repeat to override profile\n  --dry-run                      Write a report without running commands\n  --keep-going                   Continue after failed steps\n  --out-dir <dir>                Report directory (default: .validation-runs)\n  --json                         Print the report JSON to stdout\n  --no-write                     Do not write report files\n  --no-agent-ci-logs             Skip Agent CI timeline summary\n  --list                         List profiles and steps\n`,
  );
}

function printList() {
  console.log("Profiles:");
  for (const [name, steps] of Object.entries(PROFILES)) {
    console.log(`  ${name}: ${steps.join(", ")}`);
  }
  console.log("\nSteps:");
  for (const [name, step] of Object.entries(STEP_DEFINITIONS)) {
    console.log(`  ${name}: ${step.command} ${step.args.join(" ")}`);
  }
}

// fallow-ignore-next-line complexity
async function main() {
  const options = parseValidationProfileArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }
  if (options.list) {
    printList();
    return 0;
  }
  const report = await runValidationProfile(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  }
  if (report.outputs && !options.json) {
    console.log(`validation profile written: ${report.outputs.latestMdPath}`);
  }
  return report.status === "succeeded" ? 0 : 1;
}

const mainPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (mainPath && fileURLToPath(import.meta.url) === mainPath) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
