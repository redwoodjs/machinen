#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

const USAGE =
  "usage: node scripts/known-symbol-extract.mjs [verify] [--out-dir path] [--json] [--keep]";
const HEAP_STATE_SYMBOL = "machinen_controlled_heap_state";
const BUILD_ID = "4174174174174170";
const MARKER = "MACHINEN_CONTROLLED_BINARY ";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "known-symbol-extract",
      "known-symbol extraction proof uses Linux /proc and ptrace",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-known-symbol-extract-");
  try {
    emitResult(verifyKnownSymbolExtraction(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyKnownSymbolExtraction(outDir) {
  ensureSourcesExist([CONTROLLED_SOURCE, CAPTURE_SOURCE]);
  const binDir = join(outDir, "bin");
  const captureDir = join(outDir, "capture-heap");
  const bundleDir = join(outDir, "bundle");
  mkdirSync(binDir, { recursive: true });

  const target = compileControlledTarget(binDir);
  const capturer = compileRawCapturer(binDir);
  const symbols = readSymbols(target, [HEAP_STATE_SYMBOL]);
  runHeapCapture({ capturer, target, symbols, captureDir });

  const capture = loadCapture(captureDir);
  const semanticState = recoverHeapGraph(capture);
  writePortableBundle({ bundleDir, captureDir, capture, semanticState, target });
  const restoreEvent = runTargetRestore(target, bundleDir);
  validateRestore(semanticState, restoreEvent);

  return {
    formatVersion: 1,
    hostArch: hostArch(),
    captureDir,
    bundleDir,
    target,
    semanticState,
    restoreEvent,
    bundleFiles: bundleFileStats(bundleDir),
  };
}

function runHeapCapture(context) {
  const symbol = context.symbols.get(HEAP_STATE_SYMBOL);
  const resourceFile = join(context.captureDir, "resource-file.txt");
  runCommand(
    context.capturer,
    [
      "--output",
      context.captureDir,
      "--symbol",
      `${HEAP_STATE_SYMBOL}:${symbol.address}:${symbol.sizeBytes}`,
      "--",
      context.target,
      "--fixture",
      "heap",
      "--pause-at-observation",
      "--resource-file",
      resourceFile,
    ],
    {
      label: "known-symbol heap raw capture",
      env: { ...process.env, MACHINEN_CONTROLLED_ENV: "1" },
    },
  );
}

function loadCapture(captureDir) {
  return {
    manifest: readJson(join(captureDir, "manifest.json")),
    symbols: readJson(join(captureDir, "symbols.json")),
    memory: readJson(join(captureDir, "memory.json")),
    memoryBin: readFileSync(join(captureDir, "memory.bin")),
    targetLog: readFileSync(join(captureDir, "target.log"), "utf8"),
  };
}

function recoverHeapGraph(capture) {
  const heapState = chunkBytes(capture, HEAP_STATE_SYMBOL);
  const nodeCount = Number(heapState.readBigUInt64LE(8));
  const checksum = heapState.readBigUInt64LE(16);
  const headPointer = heapState.readBigUInt64LE(0);
  const nodes = [];

  for (let i = 0; i < nodeCount; i++) {
    const chunk = chunkByName(capture, `machinen_controlled_node_${i}`);
    const bytes = chunkBytesByDescriptor(capture, chunk);
    nodes.push({
      id: `controlled-node-${i}`,
      sourceAddress: chunk.sourceAddress,
      value: Number(bytes.readBigUInt64LE(0)),
      nextPointer: hexAddress(bytes.readBigUInt64LE(8)),
      sizeBytes: chunk.sizeBytes,
      memory: { offset: chunk.fileOffset, sizeBytes: chunk.sizeBytes },
    });
  }

  return {
    nodeCount,
    checksum: checksum.toString(10),
    checksumHex: hexAddress(checksum),
    headPointer: hexAddress(headPointer),
    values: nodes.map((node) => node.value),
    nodes,
    heapState: {
      sourceAddress: chunkByName(capture, HEAP_STATE_SYMBOL).sourceAddress,
      sizeBytes: heapState.length,
      memory: chunkByName(capture, HEAP_STATE_SYMBOL),
    },
  };
}

function chunkByName(capture, name) {
  const chunk = capture.memory.chunks.find((candidate) => candidate.name === name);
  if (!chunk) {
    throw new Error(`missing memory chunk: ${name}`);
  }
  return chunk;
}

function chunkBytes(capture, name) {
  return chunkBytesByDescriptor(capture, chunkByName(capture, name));
}

function chunkBytesByDescriptor(capture, chunk) {
  return capture.memoryBin.subarray(chunk.fileOffset, chunk.fileOffset + chunk.sizeBytes);
}

function hexAddress(value) {
  return `0x${value.toString(16)}`;
}

function writePortableBundle(context) {
  mkdirSync(context.bundleDir, { recursive: true });
  mkdirSync(join(context.bundleDir, "logs"), { recursive: true });

  const memory = buildBundleMemory(context.capture);
  const objects = buildObjects(memory.chunks, context.semanticState);
  writeFileSync(join(context.bundleDir, "memory.bin"), memory.bytes);
  writeFileSync(join(context.bundleDir, "manifest.json"), json(manifest(context)));
  writeFileSync(join(context.bundleDir, "objects.json"), json(objects));
  writeFileSync(
    join(context.bundleDir, "relocations.json"),
    json(relocations(context.semanticState)),
  );
  writeFileSync(join(context.bundleDir, "resources.json"), json(resources(context.capture)));
  writeFileSync(
    join(context.bundleDir, "controlled-state.txt"),
    controlledStateText(context.semanticState),
  );
  copyFileSync(
    join(context.captureDir, "target.log"),
    join(context.bundleDir, "logs/source-target.log"),
  );
}

function buildBundleMemory(capture) {
  const chunks = capture.memory.chunks.map((source) => ({ ...source }));
  const buffers = [];
  let offset = 0;
  for (const chunk of chunks) {
    const bytes = chunkBytesByDescriptor(capture, chunk);
    chunk.bundleOffset = offset;
    buffers.push(bytes);
    offset += bytes.length;
  }
  return { chunks, bytes: Buffer.concat(buffers) };
}

function buildObjects(chunks, semanticState) {
  const byName = new Map(chunks.map((chunk) => [chunk.name, chunk]));
  const heapState = byName.get(HEAP_STATE_SYMBOL);
  return {
    formatVersion: 1,
    objects: [
      heapStateObject(heapState),
      ...semanticState.nodes.map((node, index) => nodeObject(byName, node, index)),
    ],
    unsupported: unsupported(),
  };
}

function heapStateObject(chunk) {
  return {
    id: "controlled-heap-state",
    kind: "global",
    type: "struct ControlledHeapState",
    sizeBytes: chunk.sizeBytes,
    sourceAddress: chunk.sourceAddress,
    memory: { offset: chunk.bundleOffset, sizeBytes: chunk.sizeBytes },
  };
}

function nodeObject(byName, node, index) {
  const chunk = byName.get(`machinen_controlled_node_${index}`);
  return {
    id: node.id,
    kind: "heap",
    type: "struct ControlledNode",
    sizeBytes: chunk.sizeBytes,
    sourceAddress: chunk.sourceAddress,
    allocation: { id: index + 1, sourceAddress: chunk.sourceAddress },
    memory: { offset: chunk.bundleOffset, sizeBytes: chunk.sizeBytes },
  };
}

function manifest(context) {
  return {
    formatVersion: 1,
    sourceGuestArch: hostArch(),
    allowedTargetGuestArchs: ["arm64", "amd64"],
    program: {
      name: "controlled-binary-corpus",
      executable: context.target,
      identity: "com.redwoodjs.machinen.controlled-binary-corpus",
    },
    sourceBuild: { buildId: BUILD_ID, version: "known-symbol-proof" },
    targetBuild: { version: "known-symbol-proof" },
    checkpointAbi: {
      version: 1,
      checkpointFunction: { name: "machinen_checkpoint" },
      rootsType: "machinen_checkpoint_roots",
      restoreBundleType: "machinen_restore_bundle",
      safePoint: { outsideSignalHandlers: true, outsideSyscalls: true },
    },
    checkpointContinuation: { name: "machinen_controlled_heap_observation" },
    restoreEntrypoint: { name: "machinen_controlled_known_symbol_restore" },
    process: {
      argv: context.capture.manifest.target.argv,
      env: { MACHINEN_CONTROLLED_ENV: "1" },
      cwd: process.cwd(),
    },
    features: ["controlled-binary-corpus", "external-raw-capture", "known-symbol-extraction"],
    unsupported: unsupported(),
  };
}

function relocations(semanticState) {
  return {
    formatVersion: 1,
    relocations: [heapHeadRelocation(semanticState), ...nodeRelocations(semanticState)],
    unsupported: unsupported(),
  };
}

function heapHeadRelocation(semanticState) {
  return {
    fromObject: "controlled-heap-state",
    fromOffset: 0,
    toObject: "controlled-node-0",
    addend: 0,
    kind: "pointer",
    sourcePointer: semanticState.headPointer,
  };
}

function nodeRelocations(semanticState) {
  const relocations = [];
  for (let i = 0; i + 1 < semanticState.nodes.length; i++) {
    relocations.push({
      fromObject: `controlled-node-${i}`,
      fromOffset: 8,
      toObject: `controlled-node-${i + 1}`,
      addend: 0,
      kind: "pointer",
      sourcePointer: semanticState.nodes[i].nextPointer,
    });
  }
  return relocations;
}

function resources(capture) {
  return {
    formatVersion: 1,
    resources: [
      { id: "argv", kind: "argv", state: "captured", argv: capture.manifest.target.argv },
      { id: "env", kind: "env", state: "captured", env: { MACHINEN_CONTROLLED_ENV: "1" } },
      { id: "cwd", kind: "cwd", state: "captured", path: process.cwd() },
    ],
    unsupported: unsupported(),
  };
}

function controlledStateText(semanticState) {
  return [
    `node_count=${semanticState.nodeCount}`,
    `value0=${semanticState.values[0]}`,
    `value1=${semanticState.values[1]}`,
    `value2=${semanticState.values[2]}`,
    `checksum=${semanticState.checksumHex}`,
    "",
  ].join("\n");
}

function unsupported() {
  return { vocabularyVersion: 1, refusals: [] };
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function runTargetRestore(target, bundleDir) {
  const result = runCommand(target, ["--restore-known-symbol-bundle", bundleDir], {
    label: "known-symbol target restore",
    env: { ...process.env, MACHINEN_CONTROLLED_ENV: "1" },
  });
  const event = parseMarker(result.stdout);
  assert(event.fixture === "known-symbol-restore", "target did not emit restore marker");
  return event;
}

function parseMarker(stdout) {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(MARKER));
  if (!line) {
    throw new Error("missing controlled binary restore marker");
  }
  return JSON.parse(line.slice(MARKER.length));
}

function validateRestore(semanticState, restoreEvent) {
  assert(restoreEvent.arch === hostArch(), "restore ran on unexpected host architecture");
  assert(restoreEvent.node_count === semanticState.nodeCount, "restored node count changed");
  assert(
    JSON.stringify(restoreEvent.values) === JSON.stringify(semanticState.values),
    "restored node values changed",
  );
  assert(restoreEvent.checksum_hex === semanticState.checksumHex, "restored checksum changed");
}

function bundleFileStats(bundleDir) {
  return ["manifest.json", "objects.json", "relocations.json", "resources.json", "memory.bin"].map(
    (name) => ({ name, bytes: statSync(join(bundleDir, name)).size }),
  );
}

function printSummary(summary, temporary) {
  console.log(
    `known-symbol-extract: ${summary.hostArch} extracted ${summary.semanticState.nodeCount} heap nodes`,
  );
  console.log(`known-symbol-extract: restored values ${summary.restoreEvent.values.join(",")}`);
  if (temporary) {
    console.log("known-symbol-extract: temporary artifacts removed; pass --keep to inspect them");
  }
}

main();
