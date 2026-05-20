#!/usr/bin/env node
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CAPTURE_SOURCE,
  CONTROLLED_SOURCE,
  compileControlledTarget,
  compileRawCapturer,
  ensureSourcesExist,
  hostArch,
  readJson,
  readSymbols,
} from "./controlled-corpus-utils.mjs";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  emitSkip,
  parseVerifyArgs,
  runCommand,
} from "./proof-script-utils.mjs";
const WANTED_SYMBOLS = [
  "machinen_controlled_global_state",
  "machinen_controlled_resource_state",
  "machinen_controlled_thread_states",
];
const CAPTURE_PLANS = [
  { name: "global", fixture: "global", symbols: ["machinen_controlled_global_state"] },
  { name: "resource", fixture: "resource", symbols: ["machinen_controlled_resource_state"] },
  { name: "threads", fixture: "threads", symbols: ["machinen_controlled_thread_states"] },
];
const USAGE =
  "usage: node scripts/raw-process-capture.mjs [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(args, "raw-process-capture", "raw process capture uses Linux /proc and ptrace");
    return;
  }

  const workspace = createWorkspace(args, "machinen-raw-capture-");
  try {
    emitResult(verifyRawCapture(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyRawCapture(outDir) {
  ensureSourcesExist([CONTROLLED_SOURCE, CAPTURE_SOURCE]);
  mkdirSync(outDir, { recursive: true });
  const binDir = join(outDir, "bin");
  mkdirSync(binDir, { recursive: true });

  const target = compileControlledTarget(binDir);
  const capturer = compileRawCapturer(binDir);
  const symbols = readSymbols(target, WANTED_SYMBOLS);
  const captures = CAPTURE_PLANS.map((plan) =>
    runCapturePlan(plan, { capturer, target, symbols, outDir }),
  );
  const summary = { formatVersion: 1, hostArch: hostArch(), target, capturer, captures };
  validateSummary(summary);
  return summary;
}

function runCapturePlan(plan, context) {
  const captureDir = join(context.outDir, `capture-${plan.name}`);
  const resourceFile = join(captureDir, "resource-file.txt");
  const args = ["--output", captureDir, ...symbolArgs(plan.symbols, context.symbols)];
  args.push("--", context.target, "--fixture", plan.fixture, "--pause-at-observation");
  args.push("--resource-file", resourceFile);

  runCommand(context.capturer, args, {
    label: `${plan.name} raw capture`,
    env: { ...process.env, MACHINEN_CONTROLLED_ENV: "1" },
  });

  const capture = loadCapture(captureDir);
  return summarizeCapture(plan, capture, captureDir, resourceFile);
}

function symbolArgs(names, symbols) {
  return names.flatMap((name) => {
    const symbol = symbols.get(name);
    return ["--symbol", `${name}:${symbol.address}:${symbol.sizeBytes}`];
  });
}

function loadCapture(captureDir) {
  return {
    manifest: readJson(join(captureDir, "manifest.json")),
    symbols: readJson(join(captureDir, "symbols.json")),
    maps: readJson(join(captureDir, "maps.json")),
    fds: readJson(join(captureDir, "fds.json")),
    threads: readJson(join(captureDir, "threads.json")),
    memory: readJson(join(captureDir, "memory.json")),
    memoryBin: readFileSync(join(captureDir, "memory.bin")),
    targetLogBytes: statSync(join(captureDir, "target.log")).size,
  };
}

function summarizeCapture(plan, capture, captureDir, resourceFile) {
  const recoveredState = recoverState(plan.name, capture);
  return {
    name: plan.name,
    captureDir,
    pid: capture.manifest.pid,
    threadCount: capture.threads.threads.length,
    mapCount: capture.maps.maps.length,
    fdCount: capture.fds.fds.length,
    symbols: capture.symbols.symbols.map((symbol) => symbol.name),
    targetLogBytes: capture.targetLogBytes,
    recoveredState,
    resourceFdCaptured: capture.fds.fds.some((fd) => fd.target === resourceFile),
    registerBytes: capture.threads.threads.map((thread) => thread.registers.sizeBytes),
  };
}

function recoverState(name, capture) {
  if (name === "global") {
    return recoverGlobalState(chunkBytes(capture, "machinen_controlled_global_state"));
  }
  if (name === "resource") {
    return recoverResourceState(chunkBytes(capture, "machinen_controlled_resource_state"));
  }
  if (name === "threads") {
    return recoverThreadState(chunkBytes(capture, "machinen_controlled_thread_states"));
  }
  throw new Error(`unknown capture plan: ${name}`);
}

function recoverGlobalState(bytes) {
  return {
    counter: Number(bytes.readBigUInt64LE(0)),
    flags: bytes.readUInt32LE(8),
    label: readCString(bytes, 12),
  };
}

function recoverResourceState(bytes) {
  return {
    argc: bytes.readUInt32LE(0),
    envSeen: bytes.readUInt32LE(4) === 1,
    fileBytes: Number(bytes.readBigUInt64LE(8)),
    fileOffset: Number(bytes.readBigUInt64LE(16)),
  };
}

function recoverThreadState(bytes) {
  const entrySize = bytes.length / 2;
  return [0, 1].map((index) => {
    const base = index * entrySize;
    return {
      id: bytes.readUInt32LE(base),
      atObservation: bytes.readUInt32LE(base + 4) === 1,
      localCounter: Number(bytes.readBigUInt64LE(base + 8)),
      continuation: readCString(bytes, base + 16),
    };
  });
}

function chunkBytes(capture, name) {
  const chunk = capture.memory.chunks.find((candidate) => candidate.name === name);
  if (!chunk) {
    throw new Error(`missing memory chunk: ${name}`);
  }
  return capture.memoryBin.subarray(chunk.fileOffset, chunk.fileOffset + chunk.sizeBytes);
}

function readCString(bytes, offset) {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) {
    end++;
  }
  return bytes.subarray(offset, end).toString("utf8");
}

function validateSummary(summary) {
  validateGlobal(summary.captures.find((capture) => capture.name === "global"));
  validateResource(summary.captures.find((capture) => capture.name === "resource"));
  validateThreads(summary.captures.find((capture) => capture.name === "threads"));
  for (const capture of summary.captures) {
    assert(capture.pid > 0, `${capture.name}: missing pid`);
    assert(capture.mapCount > 0, `${capture.name}: missing memory maps`);
    assert(capture.fdCount > 0, `${capture.name}: missing file descriptors`);
    assert(capture.targetLogBytes > 0, `${capture.name}: missing target log`);
    assert(
      capture.registerBytes.every((size) => size > 0),
      `${capture.name}: missing registers`,
    );
  }
}

function validateGlobal(capture) {
  assert(capture?.recoveredState.counter === 1000, "global counter not recovered from memory");
  assert(capture.recoveredState.flags === 0xa5a5, "global flags not recovered from memory");
  assert(
    capture.recoveredState.label === "global-scalar-v1",
    "global label not recovered from memory",
  );
}

function validateResource(capture) {
  assert(capture?.recoveredState.envSeen === true, "resource env flag not recovered from memory");
  assert(
    capture.recoveredState.fileBytes === "machinen-controlled-resource\n".length,
    "resource byte count changed",
  );
  assert(capture.recoveredState.fileOffset === 9, "resource file offset changed");
  assert(capture.resourceFdCaptured === true, "resource file descriptor was not captured");
}

function validateThreads(capture) {
  assert(capture?.threadCount >= 3, "thread fixture should expose main plus two workers");
  assert(
    JSON.stringify(capture.recoveredState.map((thread) => thread.id)) === JSON.stringify([0, 1]),
    "thread ids changed",
  );
  assert(
    JSON.stringify(capture.recoveredState.map((thread) => thread.localCounter)) ===
      JSON.stringify([2001, 2002]),
    "thread counters changed",
  );
  assert(
    capture.recoveredState.every((thread) => thread.atObservation),
    "thread observation flags missing",
  );
}

function printSummary(summary, temporary) {
  console.log(
    `raw-process-capture: ${summary.hostArch} captured ${summary.captures.length} stopped processes`,
  );
  for (const capture of summary.captures) {
    console.log(
      `raw-process-capture: ${capture.name} pid=${capture.pid} threads=${capture.threadCount} maps=${capture.mapCount} fds=${capture.fdCount}`,
    );
  }
  if (temporary) {
    console.log("raw-process-capture: temporary artifacts removed; pass --keep to inspect them");
  }
}

main();
