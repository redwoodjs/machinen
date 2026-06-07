#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const DEFAULT_MAX_FUNCTION_LINES = 256;
const DEFAULT_MAX_FILE_LINES = 1000;

const options = parseArgs(process.argv.slice(2));
const baseRef = resolveBaseRef(options.changedSince);
const changedFiles = changedFilesSince(baseRef);

if (changedFiles.size === 0) {
  console.log(`fallow-health-guard: no changed files vs ${baseRef}`);
  process.exit(0);
}

const health = runFallowHealth();
const failures = healthFailures(health, changedFiles, options);

if (failures.length > 0) {
  console.error(
    `fallow-health-guard: ${failures.length} health issue(s) in changed files vs ${baseRef}`,
  );
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `fallow-health-guard: checked ${changedFiles.size} changed file(s) vs ${baseRef}; no health regressions`,
);

function parseArgs(argv) {
  const parsed = {
    changedSince: process.env.FALLOW_HEALTH_BASE,
    maxFunctionLines: DEFAULT_MAX_FUNCTION_LINES,
    maxFileLines: DEFAULT_MAX_FILE_LINES,
  };
  const valueFlags = new Map([
    ["--changed-since", (value) => (parsed.changedSince = value)],
    ["--base", (value) => (parsed.changedSince = value)],
    [
      "--max-function-lines",
      (value) => (parsed.maxFunctionLines = positiveInteger(value, "--max-function-lines")),
    ],
    [
      "--max-file-lines",
      (value) => (parsed.maxFileLines = positiveInteger(value, "--max-file-lines")),
    ],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const applyValue = valueFlags.get(arg);
    if (applyValue) {
      applyValue(requiredValue(argv, (index += 1), arg));
    } else {
      handleFlagWithoutValue(arg);
    }
  }

  return parsed;
}

function handleFlagWithoutValue(arg) {
  if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  }
  throw new Error(`unknown argument: ${arg}`);
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function printHelp() {
  console.log(
    `usage: node scripts/fallow-health-guard.mjs [options]\n\nOptions:\n  --changed-since <ref>       Git ref to compare against (default: FALLOW_HEALTH_BASE, origin/main, or CI base)\n  --max-function-lines <n>    Max allowed lines for functions in changed files (default: ${DEFAULT_MAX_FUNCTION_LINES})\n  --max-file-lines <n>        Max allowed total lines for changed files (default: ${DEFAULT_MAX_FILE_LINES})\n`,
  );
}

function resolveBaseRef(explicitBase) {
  for (const baseRef of candidateBaseRefs(explicitBase)) {
    ensureRefAvailable(baseRef);
    return baseRef;
  }
  throw new Error(
    "could not determine a base ref for fallow-health-guard; set FALLOW_HEALTH_BASE or pass --changed-since",
  );
}

function candidateBaseRefs(explicitBase) {
  return [
    explicitBase,
    githubBaseRef(),
    existingRef("origin/main"),
    eventBeforeRef(),
    existingRef("HEAD~1"),
  ].filter(Boolean);
}

function githubBaseRef() {
  return process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined;
}

function existingRef(ref) {
  return hasGitRef(ref) ? ref : undefined;
}

function eventBeforeRef() {
  if (!process.env.GITHUB_EVENT_PATH || !existsSync(process.env.GITHUB_EVENT_PATH)) {
    return undefined;
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  return validBeforeSha(event.before) ? event.before : undefined;
}

function validBeforeSha(value) {
  return typeof value === "string" && value !== "0000000000000000000000000000000000000000";
}

function ensureRefAvailable(ref) {
  if (!hasGitRef(ref)) {
    fetchRef(ref);
  }
  if (!hasGitRef(ref)) {
    throw new Error(`git ref not found: ${ref}`);
  }
}

function fetchRef(ref) {
  const remoteBranch = ref.startsWith("origin/") ? ref.slice("origin/".length) : undefined;
  const fetchTarget = remoteBranch ? `${remoteBranch}:refs/remotes/origin/${remoteBranch}` : ref;
  runGit(["fetch", "--depth=1", "origin", fetchTarget], { allowFailure: true });
}

function hasGitRef(ref) {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function changedFilesSince(baseRef) {
  const files = new Set();
  addGitFiles(files, ["diff", "--name-only", "--diff-filter=ACMR", `${baseRef}...HEAD`], {
    allowFailure: true,
  });
  if (files.size === 0) {
    addGitFiles(files, ["diff", "--name-only", "--diff-filter=ACMR", baseRef, "HEAD"], {
      allowFailure: true,
    });
  }
  addGitFiles(files, ["diff", "--name-only", "--diff-filter=ACMR", "--cached"]);
  addGitFiles(files, ["diff", "--name-only", "--diff-filter=ACMR"]);
  return files;
}

function addGitFiles(files, args, options = {}) {
  const result = runGit(args, options);
  if (result.status !== 0) {
    return;
  }
  for (const line of result.stdout.split(/\r?\n/u)) {
    if (line) {
      files.add(line);
    }
  }
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function runFallowHealth() {
  const result = spawnSync(fallowBin(), ["health", "--format", "json", "--quiet"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `could not parse fallow health JSON (exit ${result.status}): ${error.message}\n${result.stderr}${result.stdout}`,
    );
  }
}

function fallowBin() {
  return process.platform === "win32" ? "node_modules/.bin/fallow.cmd" : "node_modules/.bin/fallow";
}

function healthFailures(health, changedFiles, options) {
  return [
    ...complexityFailures(arrayValue(health.findings), changedFiles),
    ...largeFunctionFailures(
      arrayValue(health.large_functions),
      changedFiles,
      options.maxFunctionLines,
    ),
    ...largeFileFailures(arrayValue(health.file_scores), changedFiles, options.maxFileLines),
    ...targetFailures(arrayValue(health.targets), changedFiles),
  ];
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function complexityFailures(findings, changedFiles) {
  return findings
    .filter((finding) => changedFiles.has(finding.path))
    .map(
      (finding) =>
        `${finding.path}:${finding.line} ${finding.name} exceeds complexity/CRAP thresholds ` +
        `(cyclomatic ${finding.cyclomatic}, cognitive ${finding.cognitive}, CRAP ${finding.crap})`,
    );
}

function largeFunctionFailures(functions, changedFiles, maxLines) {
  return functions
    .filter((fn) => changedFiles.has(fn.path) && fn.line_count > maxLines)
    .map((fn) => `${fn.path}:${fn.line} ${fn.name} is ${fn.line_count} lines; max is ${maxLines}`);
}

function largeFileFailures(files, changedFiles, maxLines) {
  return files
    .filter((file) => changedFiles.has(file.path) && file.lines > maxLines)
    .map((file) => `${file.path} is ${file.lines} lines; max is ${maxLines}`);
}

function targetFailures(targets, changedFiles) {
  return targets
    .filter((target) => changedFiles.has(target.path))
    .map(
      (target) => `${target.path} remains a fallow refactoring target: ${target.recommendation}`,
    );
}
