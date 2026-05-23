#!/usr/bin/env node
// Guardrail for simplification: tracked files may only shrink; new files
// must stay under MAX_LINES. Complements fallow (function complexity) with
// a file-size axis. See docs/guides/simplification.md.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASELINE_PATH = join(REPO_ROOT, "fallow-baselines/file-sizes.json");
const MAX_LINES = 1000;

const SOURCE_DIRS = ["packages", "scripts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".zig", ".sh"]);
const IGNORE_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".zig-cache",
  "test-fixtures",
  "__tests__",
]);
const IGNORE_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

function usage(exitCode = 2) {
  console.error(`usage:
  node scripts/check-file-sizes.mjs [--changed-since <ref>]
  node scripts/check-file-sizes.mjs --save-baseline

options:
  --changed-since <ref>   Only fail on files changed since ref (default: origin/main)
  --save-baseline       Write current counts for files >= ${MAX_LINES} lines
`);
  process.exit(exitCode);
}

function shouldSkipDir(name) {
  return IGNORE_DIR_NAMES.has(name);
}

function isSourceFile(path) {
  for (const ext of SOURCE_EXTENSIONS) {
    if (path.endsWith(ext)) {
      return !IGNORE_FILE_PATTERN.test(path);
    }
  }
  return false;
}

function walkDirEntry(entry, dir, files) {
  if (entry.isDirectory()) {
    if (!shouldSkipDir(entry.name)) {
      walkSources(join(dir, entry.name), files);
    }
    return;
  }
  const path = join(dir, entry.name);
  if (isSourceFile(path)) {
    files.push(path);
  }
}

function walkSources(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    walkDirEntry(entry, dir, files);
  }
  return files;
}

function countLines(path) {
  return readFileSync(path, "utf8").split("\n").length;
}

function loadBaseline() {
  try {
    const raw = readFileSync(BASELINE_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { files: {} };
    }
    throw err;
  }
}

function listChangedFiles(ref) {
  try {
    const out = execSync(`git diff --name-only ${ref}...HEAD`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(
      out
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => resolve(REPO_ROOT, line)),
    );
  } catch {
    return null;
  }
}

function collectCounts() {
  const counts = new Map();
  for (const dir of SOURCE_DIRS) {
    const abs = join(REPO_ROOT, dir);
    if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }
    for (const path of walkSources(abs)) {
      counts.set(relative(REPO_ROOT, path), countLines(path));
    }
  }
  return counts;
}

function saveBaseline(counts) {
  const files = {};
  for (const [path, lines] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (lines >= MAX_LINES) {
      files[path] = lines;
    }
  }
  const payload = {
    description:
      "Grandfathered file line counts. Tracked files may only shrink until below MAX_LINES.",
    max_lines: MAX_LINES,
    files,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `saved ${Object.keys(files).length} file(s) to ${relative(REPO_ROOT, BASELINE_PATH)}`,
  );
}

function failureForFile(rel, lines, ceiling) {
  if (ceiling !== undefined) {
    if (lines > ceiling) {
      return `${rel}: ${lines} lines (baseline ${ceiling}, grew by ${lines - ceiling})`;
    }
    return undefined;
  }
  if (lines > MAX_LINES) {
    return `${rel}: ${lines} lines (new file over ${MAX_LINES}-line cap)`;
  }
  return undefined;
}

// fallow-ignore-next-line complexity
function check(counts, baseline, changedSince) {
  const changed = listChangedFiles(changedSince);
  const failures = [];

  for (const [rel, lines] of counts.entries()) {
    if (changed && !changed.has(resolve(REPO_ROOT, rel))) {
      continue;
    }
    const failure = failureForFile(rel, lines, baseline.files?.[rel]);
    if (failure) {
      failures.push(failure);
    }
  }

  if (failures.length === 0) {
    const scope = changed ? `changed files vs ${changedSince}` : "all files";
    console.log(`✓ file sizes ok (${scope})`);
    return 0;
  }

  console.error(`file-size check failed (${failures.length}):`);
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  console.error("\nSee docs/guides/simplification.md");
  return 1;
}

// fallow-ignore-next-line complexity
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    usage(0);
  }
  const saving = argv.includes("--save-baseline");
  const changedIndex = argv.indexOf("--changed-since");
  const changedSince = changedIndex === -1 ? "origin/main" : argv[changedIndex + 1];
  if (changedIndex !== -1 && !changedSince) {
    usage();
  }

  const counts = collectCounts();
  if (saving) {
    saveBaseline(counts);
    return;
  }
  process.exit(check(counts, loadBaseline(), changedSince));
}

main();
