import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ARG_HANDLERS = [
  { match: (arg) => arg === "verify", consume: keepIndex },
  { match: (arg) => arg === "--out-dir", consume: consumeOutDir },
  { match: (arg) => arg.startsWith("--out-dir="), consume: consumeInlineOutDir },
  { match: (arg) => arg === "--json", consume: consumeJson },
  { match: (arg) => arg === "--keep", consume: consumeKeep },
  { match: (arg) => arg === "--help" || arg === "-h", consume: consumeHelp },
];

export function parseVerifyArgs(argv, usageText) {
  const state = { outDir: "", json: false, keep: false, usageText };
  for (let i = 0; i < argv.length; i++) {
    const handler = ARG_HANDLERS.find((candidate) => candidate.match(argv[i]));
    assert(handler, `unknown argument: ${argv[i]}`);
    i = handler.consume(state, argv, i);
  }
  return { outDir: state.outDir, json: state.json, keep: state.keep };
}

function keepIndex(_state, _argv, index) {
  return index;
}

function consumeOutDir(state, argv, index) {
  state.outDir = resolve(requireValue(argv[index + 1], "--out-dir", state.usageText));
  return index + 1;
}

function consumeInlineOutDir(state, argv, index) {
  state.outDir = resolve(argv[index].slice("--out-dir=".length));
  return index;
}

function consumeJson(state, _argv, index) {
  state.json = true;
  return index;
}

function consumeKeep(state, _argv, index) {
  state.keep = true;
  return index;
}

function consumeHelp(state, _argv, _index) {
  printUsage(state.usageText);
  process.exit(0);
}

function requireValue(value, flag, usageText) {
  if (!value) {
    usage(`${flag} requires a value`, usageText);
  }
  return value;
}

export function createWorkspace(args, prefix) {
  if (args.outDir) {
    return { outDir: args.outDir, temporary: false };
  }
  return { outDir: mkdtempSync(join(tmpdir(), prefix)), temporary: true };
}

export function emitResult(summary, args, workspace, printSummary) {
  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  printSummary(summary, workspace.temporary && !args.keep);
}

export function cleanupWorkspace(workspace, args) {
  if (workspace.temporary && !args.keep) {
    rmSync(workspace.outDir, { recursive: true, force: true });
  }
}

export function runCommand(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: opts.env || process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const label = opts.label || command;
  assertCommandStarted(result, label);
  assertCommandPassed(result, label);
  return result;
}

function assertCommandStarted(result, label) {
  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
}

function assertCommandPassed(result, label) {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function usage(message, usageText) {
  console.error(message);
  printUsage(usageText);
  process.exit(2);
}

function printUsage(usageText) {
  console.error(usageText);
}
