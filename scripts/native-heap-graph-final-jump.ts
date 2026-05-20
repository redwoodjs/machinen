#!/usr/bin/env tsx
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildNativeCodeMap } from "../packages/runtime/src/native-code-map.ts";
import { translateNativeMemory } from "../packages/runtime/src/native-memory-translation.ts";
import {
  validateNativeProcessImageBundle,
  type NativeMemoryMapping,
  type NativeProcessImageDocuments,
} from "../packages/runtime/src/native-process-image.ts";
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import { translateNativeStack } from "../packages/runtime/src/native-stack-translation.ts";
import {
  NATIVE_HEAP_GRAPH_CONTINUATION_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  NATIVE_RESUME_TRAMPOLINE_SOURCE,
  bundleFileStats,
  compileNativeHeapGraphContinuation,
  compileNativeResumeTrampoline,
  ensureSourcesExist,
  nativeEmptyRefusals,
  nativeProofBundleDocuments,
  readSymbols,
  sha256File,
  writeNativeProcessImageBundle,
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
import {
  FINAL_JUMP_GRAPH_CHECKSUM,
  FINAL_JUMP_PAGE_SIZE,
  FINAL_JUMP_RETURN_MARKER,
  FINAL_JUMP_TARGET_DATA_START,
  FINAL_JUMP_TARGET_ENTRY,
  FINAL_JUMP_TARGET_TEXT_START,
  finalJumpHex,
  jumpIntoFinalTargetNativeCode,
  requireFinalJumpAmd64Registers,
  validateFinalJumpGraphResumeEvent,
} from "./native-final-jump-utils.ts";
import {
  assertCapturedTranslationSteps,
  captureNativeArm64SourceBundle,
  capturedRegisterInput,
  capturedStackInput,
  inspectCapturedArm64Source,
  mappingContaining,
  readCapturedU64,
  translatedCapturedManifest,
  translatedCapturedStackMapping,
  translatedThreads,
  type CapturedArm64SourceFacts,
} from "./native-captured-source-utils.ts";

const USAGE =
  "usage: tsx scripts/native-heap-graph-final-jump.ts [verify] [--out-dir path] [--json] [--keep]";
const SOURCE_BUNDLE_ENV = "MACHINEN_NATIVE_HEAP_GRAPH_SOURCE_BUNDLE";
const TEXT_MARKER = "machinen-native-heap-graph-final-jump-v1";
const ACTIVE_SYMBOL = "machinen_native_heap_graph_active";
const RETURN_SYMBOL = "machinen_native_heap_graph_return";
const TARGET_SECTION = ".machinen_resume";
const ROOT_MAPPING = "mapping:heap-graph-root";
const HEAP_MAPPING = "mapping:heap-graph-nodes";
const TARGET_TEXT_MAPPING = "mapping:amd64-heap-graph-text";
const TARGET_HEAP_START = FINAL_JUMP_TARGET_DATA_START + BigInt(FINAL_JUMP_PAGE_SIZE);
const NODE_STRIDE = 64n;
const NODE_MAGIC_A = 0x4845415047524131n;
const NODE_MAGIC_B = 0x4845415047524132n;
const NODE_VALUE_A = 0x21n;
const NODE_VALUE_B = 0x2cn;

interface HeapGraphFacts extends CapturedArm64SourceFacts {
  sourceReturnAddress: bigint;
  sourceNodeA: bigint;
  sourceNodeB: bigint;
  sourceChecksum: bigint;
  heapMapping: NativeMemoryMapping;
}

interface HeapGraphContinuation {
  binary: string;
  buildId: string;
  activeSymbolAddress: string;
  returnSymbolAddress: string;
  activeSymbolSizeBytes: number;
  returnSymbolSizeBytes: number;
  returnOffset: number;
  bytes: Buffer;
}

type NativeHeapGraphFinalJumpSummary =
  | ReturnType<typeof captureArm64Source>
  | ReturnType<typeof translateAndJumpHeapGraph>
  | ReturnType<typeof sourceBundleOnArm64Skip>
  | ReturnType<typeof missingBundleSkip>
  | ReturnType<typeof unsupportedHostSkip>;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "native-heap-graph-final-jump",
      "captured heap-graph final jump uses Linux ptrace/procfs",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-native-heap-graph-final-jump-");
  try {
    emitResult(verifyNativeHeapGraphFinalJump(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeHeapGraphFinalJump(outDir: string): NativeHeapGraphFinalJumpSummary {
  const sourceBundle = process.env[SOURCE_BUNDLE_ENV];
  const handlers: Record<string, () => NativeHeapGraphFinalJumpSummary> = {
    arm64: () => (sourceBundle ? sourceBundleOnArm64Skip() : captureArm64Source(outDir)),
    x64: () =>
      sourceBundle ? translateAndJumpHeapGraph(outDir, resolve(sourceBundle)) : missingBundleSkip(),
  };
  return (handlers[process.arch] ?? unsupportedHostSkip)();
}

function sourceBundleOnArm64Skip() {
  return { skipped: true, reason: `${SOURCE_BUNDLE_ENV} is only consumed on Linux/amd64` };
}

function missingBundleSkip() {
  return {
    skipped: true,
    reason: `${SOURCE_BUNDLE_ENV} must point at an arm64 source bundle for the amd64 heap-graph final jump`,
  };
}

function unsupportedHostSkip() {
  return { skipped: true, reason: `unsupported host architecture: ${process.arch}` };
}

function captureArm64Source(outDir: string) {
  const { sourceBundleDir, capturer, target, sourceBundle, facts } = captureNativeArm64SourceBundle(
    {
      outDir,
      targetSource: NATIVE_HEAP_GRAPH_CONTINUATION_SOURCE,
      compileTarget: compileNativeHeapGraphContinuation,
      resourceFileName: "native-heap-graph-resource.txt",
      label: "native heap-graph source capture",
    },
  );
  const graph = inspectHeapGraph(sourceBundle, facts);
  return {
    formatVersion: 1,
    phase: "capture-source",
    hostArch: "arm64",
    sourceBundleDir,
    capturer,
    target,
    pid: sourceBundle.manifest.capture.pid,
    threadId: graph.thread.id,
    capturedSourcePc: finalJumpHex(graph.sourcePc),
    capturedSourcePointer: finalJumpHex(graph.sourcePointer),
    capturedSourceReturnAddress: finalJumpHex(graph.sourceReturnAddress),
    sourceNodeA: finalJumpHex(graph.sourceNodeA),
    sourceNodeB: finalJumpHex(graph.sourceNodeB),
    sourceChecksum: finalJumpHex(graph.sourceChecksum),
    graphChecksum: finalJumpHex(graph.sourceChecksum),
    execution: "captured-arm64-source-awaiting-amd64-heap-graph-final-jump",
    bundleFiles: bundleFileStats(sourceBundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function translateAndJumpHeapGraph(outDir: string, sourceBundleDir: string) {
  ensureSourcesExist([NATIVE_RESUME_TRAMPOLINE_SOURCE, NATIVE_HEAP_GRAPH_CONTINUATION_SOURCE]);
  const sourceBundle = validateNativeProcessImageBundle(sourceBundleDir);
  const graph = inspectHeapGraph(sourceBundle, inspectCapturedArm64Source(sourceBundle));
  const binDir = join(outDir, "bin");
  const bundleDir = join(outDir, "bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });

  const trampoline = compileNativeResumeTrampoline(binDir);
  const targetBinary = compileNativeHeapGraphContinuation(binDir);
  const continuation = extractHeapGraphContinuation(targetBinary, binDir);
  const translatedReturnAddress = FINAL_JUMP_TARGET_ENTRY + BigInt(continuation.returnOffset);
  const codeMap = buildNativeCodeMap(codeMapInput(graph, continuation, translatedReturnAddress));
  const stack = translateNativeStack(
    capturedStackInput(
      graph,
      codeMap.codeLocations,
      "frame:captured-heap-graph-active",
      graph.sourceReturnAddress,
    ),
  );
  const registers = translateNativeRegisterState(
    capturedRegisterInput(graph, FINAL_JUMP_TARGET_ENTRY),
  );
  const memory = translateNativeMemory(heapGraphMemoryInput(graph));
  const resources = translateNativeResources({ resources: sourceBundle.resources.resources });
  assertCapturedTranslationSteps({ codeMap, registers, stack, memory }, "heap-graph final-jump");
  assertTranslatedHeapGraph(memory);

  writeNativeProcessImageBundle(
    bundleDir,
    nativeProofBundleDocuments(
      heapGraphBundleMemory(TEXT_MARKER, continuation.bytes),
      translatedCapturedManifest(sourceBundle),
      translatedMappings(graph, continuation),
      translatedThreads(graph),
      resources.resources,
      { codeMap, registers, stack, memory, resources },
      { vocabularyVersion: 1, refusals: resources.refusals },
    ),
  );
  const translatedBundle = validateNativeProcessImageBundle(bundleDir);
  const targetRegisters = requireFinalJumpAmd64Registers(
    registers.threads[0],
    "heap-graph-final-jump",
  );
  const resumeEvent = jumpIntoFinalTargetNativeCode({
    label: "heap-graph-final-jump",
    trampoline,
    bundleDir,
    targetRegisters,
    textMarker: TEXT_MARKER,
    expectedInitialDataWord0: FINAL_JUMP_TARGET_DATA_START,
    translatedReturnAddress,
    expectedReturnMarker: FINAL_JUMP_RETURN_MARKER,
    dataSizeBytes: FINAL_JUMP_PAGE_SIZE * 2,
    expectedGraphChecksum: FINAL_JUMP_GRAPH_CHECKSUM,
  });
  validateFinalJumpGraphResumeEvent(
    resumeEvent,
    "native heap-graph final jump",
    translatedReturnAddress,
  );

  return {
    formatVersion: 1,
    phase: "heap-graph-final-jump",
    hostArch: "amd64",
    sourceBundleDir,
    bundleDir,
    trampoline,
    targetBinary: continuation.binary,
    targetBuildId: continuation.buildId,
    activeSymbol: ACTIVE_SYMBOL,
    returnSymbol: RETURN_SYMBOL,
    sourcePid: sourceBundle.manifest.capture.pid,
    threadId: graph.thread.id,
    capturedSourcePc: finalJumpHex(graph.sourcePc),
    capturedSourcePointer: finalJumpHex(graph.sourcePointer),
    capturedSourceReturnAddress: finalJumpHex(graph.sourceReturnAddress),
    sourceNodeA: finalJumpHex(graph.sourceNodeA),
    sourceNodeB: finalJumpHex(graph.sourceNodeB),
    translatedEntry: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    translatedReturnAddress: finalJumpHex(translatedReturnAddress),
    translatedArgument: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
    translatedNodeA: finalJumpHex(TARGET_HEAP_START),
    translatedNodeB: finalJumpHex(TARGET_HEAP_START + NODE_STRIDE),
    graphChecksum: finalJumpHex(graph.sourceChecksum),
    codeLocations: codeMap.codeLocations.length,
    stackRelocations: stack.relocations.length,
    memoryRelocations: memory.relocations.length,
    execution: "captured-arm64-heap-graph-walked-after-native-amd64-ret",
    resumeEvent,
    bundleTargetArch: translatedBundle.manifest.target.arch,
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function inspectHeapGraph(
  bundle: NativeProcessImageDocuments,
  facts: CapturedArm64SourceFacts,
): HeapGraphFacts {
  const sourceReturnAddress = capturedArm64ReturnAddress(facts);
  const sourceNodeA = readCapturedU64(bundle, facts.dataMapping, facts.sourcePointer + 16n);
  const nodeCount = readCapturedU64(bundle, facts.dataMapping, facts.sourcePointer + 24n);
  const sourceChecksum = readCapturedU64(bundle, facts.dataMapping, facts.sourcePointer + 32n);
  assert(nodeCount === 2n, "captured heap graph root did not describe two nodes");
  assert(sourceChecksum === FINAL_JUMP_GRAPH_CHECKSUM, "captured heap graph checksum mismatched");
  const heapMapping = mappingContaining(
    bundle,
    sourceNodeA,
    (mapping) => mapping.permissions.write,
  );
  const nodeAMagic = readCapturedU64(bundle, heapMapping, sourceNodeA);
  const nodeAValue = readCapturedU64(bundle, heapMapping, sourceNodeA + 8n);
  const sourceNodeB = readCapturedU64(bundle, heapMapping, sourceNodeA + 16n);
  const nodeBMagic = readCapturedU64(bundle, heapMapping, sourceNodeB);
  const nodeBValue = readCapturedU64(bundle, heapMapping, sourceNodeB + 8n);
  const nodeBNext = readCapturedU64(bundle, heapMapping, sourceNodeB + 16n);
  assert(nodeAMagic === NODE_MAGIC_A, "captured heap node A magic mismatched");
  assert(nodeBMagic === NODE_MAGIC_B, "captured heap node B magic mismatched");
  assert(nodeAValue === NODE_VALUE_A, "captured heap node A value mismatched");
  assert(nodeBValue === NODE_VALUE_B, "captured heap node B value mismatched");
  assert(nodeBNext === 0n, "captured heap node B should terminate the graph");
  assert(sourceNodeB - sourceNodeA === NODE_STRIDE, "captured heap node stride mismatched");
  return {
    ...facts,
    sourceReturnAddress,
    sourceNodeA,
    sourceNodeB,
    sourceChecksum,
    heapMapping,
  };
}

function capturedArm64ReturnAddress(facts: CapturedArm64SourceFacts) {
  const sourceReturnAddress = BigInt(facts.thread.sourceRegisters.x[30] ?? "0x0");
  assert(sourceReturnAddress !== 0n, "captured arm64 x30 did not hold a return address");
  assert(sourceReturnAddress !== facts.sourcePc, "captured arm64 return address matched PC");
  return sourceReturnAddress;
}

function extractHeapGraphContinuation(targetBinary: string, binDir: string): HeapGraphContinuation {
  const symbols = readSymbols(targetBinary, [ACTIVE_SYMBOL, RETURN_SYMBOL]);
  const active = symbols.get(ACTIVE_SYMBOL);
  const landing = symbols.get(RETURN_SYMBOL);
  assert(active, `target binary symbol missing: ${ACTIVE_SYMBOL}`);
  assert(landing, `target binary symbol missing: ${RETURN_SYMBOL}`);
  const activeAddress = BigInt(active.address);
  const landingAddress = BigInt(landing.address);
  assert(landingAddress > activeAddress, `${RETURN_SYMBOL} must follow ${ACTIVE_SYMBOL}`);
  const returnOffset = Number(landingAddress - activeAddress);
  const sectionPath = join(binDir, "machinen-heap-graph-resume.bin");
  runCommand("objcopy", ["--dump-section", `${TARGET_SECTION}=${sectionPath}`, targetBinary], {
    label: "heap-graph continuation section extract",
  });
  const sectionBytes = readFileSync(sectionPath);
  const requiredBytes = returnOffset + landing.sizeBytes;
  assert(requiredBytes <= sectionBytes.length, `${TARGET_SECTION} did not include both functions`);
  const bytes = sectionBytes.subarray(0, requiredBytes);
  assert(bytes[0] === 0x48 && bytes[1] === 0x89, `${ACTIVE_SYMBOL} did not start with amd64 code`);
  return {
    binary: targetBinary,
    buildId: sha256File(targetBinary),
    activeSymbolAddress: active.address,
    returnSymbolAddress: landing.address,
    activeSymbolSizeBytes: active.sizeBytes,
    returnSymbolSizeBytes: landing.sizeBytes,
    returnOffset,
    bytes,
  };
}

function codeMapInput(
  graph: HeapGraphFacts,
  continuation: HeapGraphContinuation,
  translatedReturnAddress: bigint,
) {
  return {
    expectedTargetBuildId: continuation.buildId,
    targetBuildId: continuation.buildId,
    sourceSymbols: [
      {
        name: ACTIVE_SYMBOL,
        mapping: graph.textMapping.id,
        address: finalJumpHex(graph.sourcePc),
        sizeBytes: 64,
        metadata: "sidecar" as const,
      },
      {
        name: RETURN_SYMBOL,
        mapping: graph.textMapping.id,
        address: finalJumpHex(graph.sourceReturnAddress),
        sizeBytes: 64,
        metadata: "sidecar" as const,
      },
    ],
    targetSymbols: [
      {
        name: ACTIVE_SYMBOL,
        mapping: TARGET_TEXT_MAPPING,
        address: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
        sizeBytes: continuation.activeSymbolSizeBytes,
        buildId: continuation.buildId,
        metadata: "symbol" as const,
      },
      {
        name: RETURN_SYMBOL,
        mapping: TARGET_TEXT_MAPPING,
        address: finalJumpHex(translatedReturnAddress),
        sizeBytes: continuation.returnSymbolSizeBytes,
        buildId: continuation.buildId,
        metadata: "symbol" as const,
      },
    ],
    requestedLocations: [
      {
        id: "code:captured-heap-graph-active",
        symbol: ACTIVE_SYMBOL,
        sourceAddress: finalJumpHex(graph.sourcePc),
      },
      {
        id: "code:captured-heap-graph-return",
        symbol: RETURN_SYMBOL,
        sourceAddress: finalJumpHex(graph.sourceReturnAddress),
      },
    ],
  };
}

function heapGraphMemoryInput(graph: HeapGraphFacts) {
  return {
    words: [
      {
        mapping: ROOT_MAPPING,
        offset: 0,
        sourceValue: finalJumpHex(graph.sourcePointer),
        targetValue: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
        classification: "pointer" as const,
        proof: "sidecar" as const,
      },
      {
        mapping: ROOT_MAPPING,
        offset: 16,
        sourceValue: finalJumpHex(graph.sourceNodeA),
        targetValue: finalJumpHex(TARGET_HEAP_START),
        classification: "pointer" as const,
        proof: "sidecar" as const,
      },
      {
        mapping: HEAP_MAPPING,
        offset: 16,
        sourceValue: finalJumpHex(graph.sourceNodeB),
        targetValue: finalJumpHex(TARGET_HEAP_START + NODE_STRIDE),
        classification: "pointer" as const,
        proof: "sidecar" as const,
      },
    ],
  };
}

function assertTranslatedHeapGraph(memory: ReturnType<typeof translateNativeMemory>) {
  const translatedPointers = memory.relocations.filter(
    (relocation) => relocation.kind === "pointer" && relocation.state === "translated",
  );
  assert(translatedPointers.length >= 3, "heap graph did not translate all pointer edges");
}

function translatedMappings(graph: HeapGraphFacts, continuation: HeapGraphContinuation) {
  return {
    formatVersion: 1,
    mappings: [
      translatedSourceTextMapping(graph.textMapping),
      translatedTextMapping(continuation),
      translatedRootMapping(graph),
      translatedHeapMapping(graph),
      translatedCapturedStackMapping(graph.stackMapping),
    ],
    refusals: nativeEmptyRefusals(),
  };
}

function translatedSourceTextMapping(mapping: NativeMemoryMapping) {
  return {
    id: mapping.id,
    kind: "text" as const,
    sourceStart: mapping.sourceStart,
    sourceEnd: mapping.sourceEnd,
    sizeBytes: mapping.sizeBytes,
    permissions: { read: true, write: false, execute: true, private: true, shared: false },
    file: mapping.file,
    target: {
      materialization: "omit" as const,
      reason: "source arm64 text is replaced by matching amd64 heap-graph target text",
    },
  };
}

function translatedTextMapping(continuation: HeapGraphContinuation) {
  return {
    id: TARGET_TEXT_MAPPING,
    kind: "text" as const,
    sourceStart: finalJumpHex(FINAL_JUMP_TARGET_TEXT_START),
    sourceEnd: finalJumpHex(FINAL_JUMP_TARGET_TEXT_START + BigInt(FINAL_JUMP_PAGE_SIZE)),
    sizeBytes: FINAL_JUMP_PAGE_SIZE,
    permissions: { read: true, write: false, execute: true, private: true, shared: false },
    file: {
      path: continuation.binary,
      offset: 0,
      buildId: continuation.buildId,
      sha256: continuation.buildId,
    },
    captured: { file: "native-memory.bin" as const, offset: 0, sizeBytes: FINAL_JUMP_PAGE_SIZE },
    target: {
      materialization: "translate" as const,
      targetStart: finalJumpHex(FINAL_JUMP_TARGET_TEXT_START),
    },
  };
}

function translatedRootMapping(graph: HeapGraphFacts) {
  return {
    id: ROOT_MAPPING,
    kind: "data" as const,
    sourceStart: finalJumpHex(graph.sourcePointer),
    sourceEnd: finalJumpHex(graph.sourcePointer + BigInt(FINAL_JUMP_PAGE_SIZE)),
    sizeBytes: FINAL_JUMP_PAGE_SIZE,
    permissions: { read: true, write: true, execute: false, private: true, shared: false },
    file: graph.dataMapping.file,
    captured: {
      file: "native-memory.bin" as const,
      offset: FINAL_JUMP_PAGE_SIZE,
      sizeBytes: FINAL_JUMP_PAGE_SIZE,
    },
    target: {
      materialization: "translate" as const,
      targetStart: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
    },
  };
}

function translatedHeapMapping(graph: HeapGraphFacts) {
  return {
    id: HEAP_MAPPING,
    kind: "heap" as const,
    sourceStart: finalJumpHex(graph.sourceNodeA),
    sourceEnd: finalJumpHex(graph.sourceNodeA + BigInt(FINAL_JUMP_PAGE_SIZE)),
    sizeBytes: FINAL_JUMP_PAGE_SIZE,
    permissions: { read: true, write: true, execute: false, private: true, shared: false },
    file: graph.heapMapping.file,
    captured: {
      file: "native-memory.bin" as const,
      offset: FINAL_JUMP_PAGE_SIZE * 2,
      sizeBytes: FINAL_JUMP_PAGE_SIZE,
    },
    target: {
      materialization: "translate" as const,
      targetStart: finalJumpHex(TARGET_HEAP_START),
    },
  };
}

function heapGraphBundleMemory(textMarker: string, targetText: Buffer) {
  const textAndRoot = finalJumpBundleMemoryFromHeapText(textMarker, targetText);
  return Buffer.concat([textAndRoot, targetHeapPage()]);
}

function finalJumpBundleMemoryFromHeapText(textMarker: string, targetText: Buffer) {
  const text = Buffer.alloc(FINAL_JUMP_PAGE_SIZE);
  text.write(textMarker, 0, "utf8");
  assert(
    targetText.length <= FINAL_JUMP_PAGE_SIZE - 128,
    "heap-graph target text does not fit in final-jump text page",
  );
  targetText.copy(text, 128);
  return Buffer.concat([text, targetRootPage()]);
}

function targetRootPage() {
  const root = Buffer.alloc(FINAL_JUMP_PAGE_SIZE);
  root.writeBigUInt64LE(FINAL_JUMP_TARGET_DATA_START, 0);
  root.writeBigUInt64LE(0x534f555243454a50n, 8);
  root.writeBigUInt64LE(TARGET_HEAP_START, 16);
  root.writeBigUInt64LE(2n, 24);
  root.writeBigUInt64LE(FINAL_JUMP_GRAPH_CHECKSUM, 32);
  root.writeBigUInt64LE(0n, 40);
  return root;
}

function targetHeapPage() {
  const heap = Buffer.alloc(FINAL_JUMP_PAGE_SIZE);
  heap.writeBigUInt64LE(NODE_MAGIC_A, 0);
  heap.writeBigUInt64LE(NODE_VALUE_A, 8);
  heap.writeBigUInt64LE(TARGET_HEAP_START + NODE_STRIDE, 16);
  const nodeBOffset = Number(NODE_STRIDE);
  heap.writeBigUInt64LE(NODE_MAGIC_B, nodeBOffset);
  heap.writeBigUInt64LE(NODE_VALUE_B, nodeBOffset + 8);
  heap.writeBigUInt64LE(0n, nodeBOffset + 16);
  return heap;
}

function printSummary(summary: ReturnType<typeof verifyNativeHeapGraphFinalJump>) {
  if ("skipped" in summary) {
    console.log(`native-heap-graph-final-jump: skip — ${summary.reason}`);
    return;
  }
  console.log(
    `native-heap-graph-final-jump: phase=${summary.phase} sourceRoot=${summary.capturedSourcePointer} sourceNodeA=${summary.sourceNodeA}`,
  );
  console.log(`native-heap-graph-final-jump: execution=${summary.execution}`);
}

main();
