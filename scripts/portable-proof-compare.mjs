#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MARKER = "MACHINEN_PORTABLE_PROOF ";
const EXPECTED_LIST = [1, 2, 3];
const EXPECTED_SYMBOLS = {
  checkpoint_symbol: "machinen_portable_checkpoint",
  restore_symbol: "machinen_portable_restore_entry",
  state_symbol: "machinen_portable_app_state",
};

export function parsePortableProofEvents(text) {
  const events = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idx = line.indexOf(MARKER);
    if (idx === -1) {
      continue;
    }
    const payload = line.slice(idx + MARKER.length);
    try {
      events.push(JSON.parse(payload));
    } catch (err) {
      throw new Error(`invalid portable proof marker JSON on line ${i + 1}: ${err.message}`);
    }
  }
  return events;
}

export function validatePortableProofEvents(events, opts = {}) {
  const errors = [];
  const checkpoint = firstPhase(events, "checkpoint");
  const restore = firstPhase(events, "restore");
  const continues = events.filter((event) => event.phase === "continue");

  if (!checkpoint) {
    errors.push("missing checkpoint marker");
  }
  if (opts.requireRestore && !restore) {
    errors.push("missing restore marker");
  }
  if (opts.requireContinue && continues.length === 0) {
    errors.push("missing continue marker");
  }

  for (const [i, event] of events.entries()) {
    validateEventShape(errors, event, i, opts.expectArch);
  }

  if (checkpoint) {
    validateSnapshotState(errors, "checkpoint", checkpoint, 1000);
  }
  if (restore) {
    validateSnapshotState(errors, "restore", restore, 1000);
  }
  if (checkpoint && restore && !sameList(checkpoint.list, restore.list)) {
    errors.push("restore list does not match checkpoint list");
  }
  if (continues.length > 0 && !continues.some((event) => Number(event.counter) > 1000)) {
    errors.push("continue markers never increment counter beyond 1000");
  }

  return errors;
}

function firstPhase(events, phase) {
  return events.find((event) => event.phase === phase);
}

function validateEventShape(errors, event, i, expectArch) {
  const prefix = `event[${i}]`;
  if (event.schema_version !== 1) {
    errors.push(`${prefix}.schema_version must be 1`);
  }
  if (!["checkpoint", "restore", "continue"].includes(event.phase)) {
    errors.push(`${prefix}.phase is unknown: ${JSON.stringify(event.phase)}`);
  }
  if (!["arm64", "amd64"].includes(event.arch)) {
    errors.push(`${prefix}.arch must be arm64 or amd64`);
  }
  if (expectArch && event.arch !== expectArch) {
    errors.push(`${prefix}.arch expected ${expectArch}, got ${event.arch}`);
  }
  if (!Number.isInteger(event.counter)) {
    errors.push(`${prefix}.counter must be an integer`);
  }
  if (!sameList(event.list, EXPECTED_LIST)) {
    errors.push(`${prefix}.list expected [1,2,3], got ${JSON.stringify(event.list)}`);
  }
  for (const [field, expected] of Object.entries(EXPECTED_SYMBOLS)) {
    if (event[field] !== expected) {
      errors.push(`${prefix}.${field} expected ${expected}, got ${JSON.stringify(event[field])}`);
    }
  }
}

function validateSnapshotState(errors, phase, event, expectedCounter) {
  if (event.counter !== expectedCounter) {
    errors.push(`${phase}.counter expected ${expectedCounter}, got ${event.counter}`);
  }
  if (!sameList(event.list, EXPECTED_LIST)) {
    errors.push(`${phase}.list expected [1,2,3], got ${JSON.stringify(event.list)}`);
  }
}

function sameList(a, b) {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index])
  );
}

function parseArgs(argv) {
  const opts = { requireRestore: false, requireContinue: false, expectArch: undefined };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--require-restore") {
      opts.requireRestore = true;
    } else if (arg === "--require-continue") {
      opts.requireContinue = true;
    } else if (arg === "--expect-arch") {
      opts.expectArch = argv[++i];
      if (!opts.expectArch) {
        usage("--expect-arch requires arm64 or amd64");
      }
    } else if (arg.startsWith("--expect-arch=")) {
      opts.expectArch = arg.slice("--expect-arch=".length);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      usage(`unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (opts.expectArch && !["arm64", "amd64"].includes(opts.expectArch)) {
    usage(`--expect-arch must be arm64 or amd64 (got ${opts.expectArch})`);
  }
  if (positional.length !== 1) {
    usage("expected one log file path or '-'");
  }
  return { ...opts, path: positional[0] };
}

function usage(message) {
  process.stderr.write(`portable-proof-compare: ${message}\n`);
  printUsage();
  process.exit(2);
}

function printUsage() {
  process.stderr.write(
    "usage: node scripts/portable-proof-compare.mjs [--expect-arch arm64|amd64] " +
      "[--require-restore] [--require-continue] <log-file|->\n",
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const text = opts.path === "-" ? readFileSync(0, "utf8") : readFileSync(opts.path, "utf8");
  const events = parsePortableProofEvents(text);
  const errors = validatePortableProofEvents(events, opts);
  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`portable-proof-compare: ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({
      ok: true,
      events: events.length,
      phases: events.map((event) => event.phase),
    }) + "\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
