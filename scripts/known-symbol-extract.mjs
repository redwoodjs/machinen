#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CAPTURE_SOURCE,
  CONTROLLED_SOURCE,
  buildPortableBundleMemory,
  bundleFileStats as sharedBundleFileStats,
  compileControlledTarget,
  compileRawCapturer,
  controlledPortableManifest,
  ensureSourcesExist,
  hostArch,
  loadRawCapture,
  memoryChunkByName,
  memoryChunkBytes,
  parseControlledMarker,
  readSymbols,
  unsupportedVocabulary,
  writePortableBundleFiles,
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

  const capture = loadRawCapture(captureDir);
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

function recoverHeapGraph(capture) {
  const heapStateChunk = memoryChunkByName(capture, HEAP_STATE_SYMBOL);
  const heapState = memoryChunkBytes(capture, heapStateChunk);
  const nodeCount = Number(heapState.readBigUInt64LE(8));
  const checksum = heapState.readBigUInt64LE(16);
  const headPointer = heapState.readBigUInt64LE(0);
  const nodes = [];

  for (let i = 0; i < nodeCount; i++) {
    const chunk = memoryChunkByName(capture, `machinen_controlled_node_${i}`);
    const bytes = memoryChunkBytes(capture, chunk);
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
      sourceAddress: heapStateChunk.sourceAddress,
      sizeBytes: heapState.length,
      memory: heapStateChunk,
    },
  };
}

function hexAddress(value) {
  return `0x${value.toString(16)}`;
}

function writePortableBundle(context) {
  const memory = buildPortableBundleMemory(context.capture);
  writePortableBundleFiles({
    bundleDir: context.bundleDir,
    captureDir: context.captureDir,
    capture: context.capture,
    memory,
    manifest: manifest(context),
    objects: buildObjects(memory.chunks, context.semanticState),
    relocations: relocations(context.semanticState),
    controlledStateText: controlledStateText(context.semanticState),
  });
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
    unsupported: unsupportedVocabulary(),
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
  return controlledPortableManifest({
    target: context.target,
    capture: context.capture,
    buildId: BUILD_ID,
    version: "known-symbol-proof",
    checkpointContinuation: "machinen_controlled_heap_observation",
    restoreEntrypoint: "machinen_controlled_known_symbol_restore",
    features: ["controlled-binary-corpus", "external-raw-capture", "known-symbol-extraction"],
  });
}

function relocations(semanticState) {
  return {
    formatVersion: 1,
    relocations: [heapHeadRelocation(semanticState), ...nodeRelocations(semanticState)],
    unsupported: unsupportedVocabulary(),
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

function runTargetRestore(target, bundleDir) {
  const result = runCommand(target, ["--restore-known-symbol-bundle", bundleDir], {
    label: "known-symbol target restore",
    env: { ...process.env, MACHINEN_CONTROLLED_ENV: "1" },
  });
  return parseControlledMarker(result.stdout, "known-symbol-restore");
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
  return sharedBundleFileStats(bundleDir, [
    "manifest.json",
    "objects.json",
    "relocations.json",
    "resources.json",
    "memory.bin",
  ]);
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
