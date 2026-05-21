#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildNativeCodeMap } from "../packages/runtime/src/native-code-map.ts";
import { classifyNativeDebugMemoryPointers } from "../packages/runtime/src/native-debug-memory.ts";
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
  NATIVE_DEBUG_POINTER_CONTINUATION_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  NATIVE_RESUME_TRAMPOLINE_SOURCE,
  bundleFileStats,
  compileNativeDebugPointerContinuation,
  compileNativeResumeTrampoline,
  createProofBinAndBundleDirs,
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
  translatedOmittedSourceTextMapping,
  translatedStackReturnAddress,
  translatedTargetTextMapping,
  translatedThreads,
  type CapturedArm64SourceFacts,
} from "./native-captured-source-utils.ts";

const USAGE =
  "usage: tsx scripts/native-dwarf-pointer-classification.ts [verify] [--out-dir path] [--json] [--keep]";
const SOURCE_BUNDLE_ENV = "MACHINEN_NATIVE_DWARF_POINTER_SOURCE_BUNDLE";
const DEBUG_METADATA_FILE = "native-debug-memory.json";
const TEXT_MARKER = "machinen-native-dwarf-pointer-classification-v1";
const ACTIVE_SYMBOL = "machinen_native_debug_pointer_active";
const RETURN_SYMBOL = "machinen_native_debug_pointer_return";
const TARGET_SECTION = ".machinen_resume";
const ROOT_MAPPING = "mapping:debug-pointer-root";
const HEAP_MAPPING = "mapping:debug-pointer-heap";
const TARGET_TEXT_MAPPING = "mapping:amd64-debug-pointer-text";
const TARGET_HEAP_START = FINAL_JUMP_TARGET_DATA_START + BigInt(FINAL_JUMP_PAGE_SIZE);
const NODE_STRIDE = 64n;
const NODE_MAGIC_A = 0x4442554750545231n;
const NODE_MAGIC_B = 0x4442554750545232n;
const NODE_VALUE_A = 0x35n;
const NODE_VALUE_B = 0x59n;
const DEBUG_GRAPH_CHECKSUM = NODE_VALUE_A + NODE_VALUE_B;

interface DebugPointerFieldLayout {
  name: string;
  offset: number;
  sizeBytes: number;
  type: string;
  classification: "integer" | "pointer";
}

interface DebugPointerLayout {
  type: string;
  byteSize: number;
  fields: DebugPointerFieldLayout[];
}

interface DebugPointerMetadata {
  formatVersion: 1;
  producer: string;
  layouts: {
    root: DebugPointerLayout;
    node: DebugPointerLayout;
  };
}

interface DebugPointerFacts extends CapturedArm64SourceFacts {
  sourceReturnAddress: bigint;
  sourceNodeA: bigint;
  sourceNodeB: bigint;
  sourceRootScalarLookalike: bigint;
  sourceNodeScalarLookalike: bigint;
  heapMapping: NativeMemoryMapping;
}

interface DebugPointerContinuation {
  binary: string;
  buildId: string;
  activeSymbolSizeBytes: number;
  returnSymbolSizeBytes: number;
  returnOffset: number;
  bytes: Buffer;
}

interface DwarfDie {
  level: number;
  offset: string;
  tag: string;
  attrs: Map<string, string>;
  children: DwarfDie[];
}

type NativeDwarfPointerClassificationSummary =
  | ReturnType<typeof captureArm64Source>
  | ReturnType<typeof translateAndJumpDebugPointerGraph>
  | ReturnType<typeof sourceBundleOnArm64Skip>
  | ReturnType<typeof missingBundleSkip>
  | ReturnType<typeof unsupportedHostSkip>;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "native-dwarf-pointer-classification",
      "debug-metadata pointer classification uses Linux ptrace/procfs and readelf",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-native-dwarf-pointer-classification-");
  try {
    emitResult(
      verifyNativeDwarfPointerClassification(workspace.outDir),
      args,
      workspace,
      printSummary,
    );
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeDwarfPointerClassification(
  outDir: string,
): NativeDwarfPointerClassificationSummary {
  const sourceBundle = process.env[SOURCE_BUNDLE_ENV];
  if (process.arch === "arm64") {
    return sourceBundle ? sourceBundleOnArm64Skip() : captureArm64Source(outDir);
  }
  if (process.arch === "x64") {
    return sourceBundle
      ? translateAndJumpDebugPointerGraph(outDir, resolve(sourceBundle))
      : missingBundleSkip();
  }
  return unsupportedHostSkip();
}

function sourceBundleOnArm64Skip() {
  return { skipped: true, reason: `${SOURCE_BUNDLE_ENV} is only consumed on Linux/amd64` };
}

function missingBundleSkip() {
  return {
    skipped: true,
    reason: `${SOURCE_BUNDLE_ENV} must point at an arm64 source bundle with ${DEBUG_METADATA_FILE}`,
  };
}

function unsupportedHostSkip() {
  return { skipped: true, reason: `unsupported host architecture: ${process.arch}` };
}

function captureArm64Source(outDir: string) {
  const { sourceBundleDir, capturer, target, sourceBundle, facts } = captureNativeArm64SourceBundle(
    {
      outDir,
      targetSource: NATIVE_DEBUG_POINTER_CONTINUATION_SOURCE,
      compileTarget: compileNativeDebugPointerContinuation,
      resourceFileName: "native-debug-pointer-resource.txt",
      label: "native debug-pointer source capture",
    },
  );
  const graph = inspectDebugPointerGraph(sourceBundle, facts);
  const metadata = readDebugPointerMetadata(target);
  validateMetadataCoversGraph(metadata, graph);
  writeFileSync(
    join(sourceBundleDir, DEBUG_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );

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
    scalarLookalikes: [
      finalJumpHex(graph.sourceRootScalarLookalike),
      finalJumpHex(graph.sourceNodeScalarLookalike),
    ],
    pointerFields: pointerFieldNames(metadata),
    scalarFields: scalarFieldNames(metadata),
    execution: "captured-arm64-source-pointers-classified-from-dwarf-metadata",
    bundleFiles: bundleFileStats(sourceBundleDir, [
      ...NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
      DEBUG_METADATA_FILE,
    ]),
  };
}

function translateAndJumpDebugPointerGraph(outDir: string, sourceBundleDir: string) {
  ensureSourcesExist([NATIVE_RESUME_TRAMPOLINE_SOURCE, NATIVE_DEBUG_POINTER_CONTINUATION_SOURCE]);
  const sourceBundle = validateNativeProcessImageBundle(sourceBundleDir);
  const graph = inspectDebugPointerGraph(sourceBundle, inspectCapturedArm64Source(sourceBundle));
  const metadata = readDebugPointerMetadataFile(sourceBundleDir);
  const { binDir, bundleDir } = createProofBinAndBundleDirs(outDir);

  const trampoline = compileNativeResumeTrampoline(binDir);
  const targetBinary = compileNativeDebugPointerContinuation(binDir);
  const continuation = extractDebugPointerContinuation(targetBinary, binDir);
  const translatedReturnAddress = FINAL_JUMP_TARGET_ENTRY + BigInt(continuation.returnOffset);
  const codeMap = buildNativeCodeMap(codeMapInput(graph, continuation, translatedReturnAddress));
  const stack = translateNativeStack(
    capturedStackInput(
      graph,
      codeMap.codeLocations,
      "frame:captured-debug-pointer-active",
      graph.sourceReturnAddress,
    ),
  );
  const pointerClassification = classifyNativeDebugMemoryPointers(
    debugMemoryClassificationInput(sourceBundle, graph, metadata),
  );
  assert(
    pointerClassification.refusals.length === 0,
    "DWARF debug-memory classification refused unexpectedly",
  );
  const registers = translateNativeRegisterState(
    capturedRegisterInput(graph, FINAL_JUMP_TARGET_ENTRY),
  );
  const memory = translateNativeMemory({ words: pointerClassification.words });
  const resources = translateNativeResources({ resources: sourceBundle.resources.resources });
  assertCapturedTranslationSteps({ codeMap, registers, stack, memory }, "DWARF pointer final-jump");
  assertScalarLookalikesPreserved(memory.relocations);
  assert(
    translatedStackReturnAddress(stack) === translatedReturnAddress,
    "debug-pointer return address did not translate to the target landing",
  );

  writeNativeProcessImageBundle(
    bundleDir,
    nativeProofBundleDocuments(
      debugPointerBundleMemory(TEXT_MARKER, continuation.bytes, graph),
      translatedCapturedManifest(sourceBundle),
      translatedMappingsDocument(graph, continuation),
      translatedThreads(graph),
      resources.resources,
      { codeMap, registers, stack, memory, resources },
      { vocabularyVersion: 1, refusals: resources.refusals },
    ),
  );
  const translatedBundle = validateNativeProcessImageBundle(bundleDir);
  const targetRegisters = requireFinalJumpAmd64Registers(
    registers.threads[0],
    "dwarf-pointer-final-jump",
  );
  const resumeEvent = jumpIntoFinalTargetNativeCode({
    label: "dwarf-pointer-final-jump",
    trampoline,
    bundleDir,
    targetRegisters,
    textMarker: TEXT_MARKER,
    expectedInitialDataWord0: FINAL_JUMP_TARGET_DATA_START,
    translatedReturnAddress,
    expectedReturnMarker: FINAL_JUMP_RETURN_MARKER,
    dataSizeBytes: FINAL_JUMP_PAGE_SIZE * 2,
    expectedGraphChecksum: DEBUG_GRAPH_CHECKSUM,
  });
  validateFinalJumpGraphResumeEvent(
    resumeEvent,
    "native DWARF pointer classification final jump",
    translatedReturnAddress,
    DEBUG_GRAPH_CHECKSUM,
  );

  return {
    formatVersion: 1,
    phase: "dwarf-pointer-final-jump",
    hostArch: "amd64",
    sourceBundleDir,
    bundleDir,
    targetBinary: continuation.binary,
    targetBuildId: continuation.buildId,
    capturedSourcePc: finalJumpHex(graph.sourcePc),
    capturedSourcePointer: finalJumpHex(graph.sourcePointer),
    sourceNodeA: finalJumpHex(graph.sourceNodeA),
    sourceNodeB: finalJumpHex(graph.sourceNodeB),
    translatedEntry: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    translatedReturnAddress: finalJumpHex(translatedReturnAddress),
    translatedRoot: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
    translatedNodeA: finalJumpHex(TARGET_HEAP_START),
    translatedNodeB: finalJumpHex(TARGET_HEAP_START + NODE_STRIDE),
    graphChecksum: finalJumpHex(DEBUG_GRAPH_CHECKSUM),
    pointerFields: pointerFieldNames(metadata),
    scalarLookalikesPreserved: true,
    memoryRelocations: memory.relocations.length,
    preservedWords: pointerClassification.preservedWords,
    execution: "captured-arm64-debug-metadata-pointers-walked-after-native-amd64-ret",
    resumeEvent,
    bundleTargetArch: translatedBundle.manifest.target.arch,
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function inspectDebugPointerGraph(
  bundle: NativeProcessImageDocuments,
  facts: CapturedArm64SourceFacts,
): DebugPointerFacts {
  const sourceReturnAddress = capturedArm64ReturnAddress(facts);
  const sourceNodeA = readCapturedU64(bundle, facts.dataMapping, facts.sourcePointer + 16n);
  const nodeCount = readCapturedU64(bundle, facts.dataMapping, facts.sourcePointer + 24n);
  const sourceRootScalarLookalike = readCapturedU64(
    bundle,
    facts.dataMapping,
    facts.sourcePointer + 32n,
  );
  const sourceChecksum = readCapturedU64(bundle, facts.dataMapping, facts.sourcePointer + 40n);
  assert(nodeCount === 2n, "captured debug pointer root did not describe two nodes");
  assert(sourceChecksum === DEBUG_GRAPH_CHECKSUM, "captured debug pointer checksum mismatched");
  assert(sourceRootScalarLookalike === sourceNodeA, "root scalar lookalike did not mimic head");
  const heapMapping = mappingContaining(
    bundle,
    sourceNodeA,
    (mapping) => mapping.permissions.write,
  );
  const nodeAMagic = readCapturedU64(bundle, heapMapping, sourceNodeA);
  const nodeAValue = readCapturedU64(bundle, heapMapping, sourceNodeA + 8n);
  const sourceNodeB = readCapturedU64(bundle, heapMapping, sourceNodeA + 16n);
  const sourceNodeScalarLookalike = readCapturedU64(bundle, heapMapping, sourceNodeA + 24n);
  const nodeBMagic = readCapturedU64(bundle, heapMapping, sourceNodeB);
  const nodeBValue = readCapturedU64(bundle, heapMapping, sourceNodeB + 8n);
  const nodeBNext = readCapturedU64(bundle, heapMapping, sourceNodeB + 16n);
  assert(nodeAMagic === NODE_MAGIC_A, "debug pointer node A magic mismatched");
  assert(nodeBMagic === NODE_MAGIC_B, "debug pointer node B magic mismatched");
  assert(nodeAValue === NODE_VALUE_A, "debug pointer node A value mismatched");
  assert(nodeBValue === NODE_VALUE_B, "debug pointer node B value mismatched");
  assert(nodeBNext === 0n, "debug pointer node B should terminate graph");
  assert(sourceNodeScalarLookalike === sourceNodeB, "node scalar lookalike did not mimic next");
  assert(sourceNodeB - sourceNodeA === NODE_STRIDE, "debug pointer node stride mismatched");
  return {
    ...facts,
    sourceReturnAddress,
    sourceNodeA,
    sourceNodeB,
    sourceRootScalarLookalike,
    sourceNodeScalarLookalike,
    heapMapping,
  };
}

function capturedArm64ReturnAddress(facts: CapturedArm64SourceFacts) {
  const sourceReturnAddress = BigInt(facts.thread.sourceRegisters.x[30] ?? "0x0");
  assert(sourceReturnAddress !== 0n, "captured arm64 x30 did not hold a return address");
  assert(sourceReturnAddress !== facts.sourcePc, "captured arm64 return address matched PC");
  return sourceReturnAddress;
}

function debugMemoryClassificationInput(
  bundle: NativeProcessImageDocuments,
  graph: DebugPointerFacts,
  metadata: DebugPointerMetadata,
) {
  return {
    addressTranslations: [
      addressTranslation(ROOT_MAPPING, graph.sourcePointer, FINAL_JUMP_TARGET_DATA_START),
      addressTranslation(HEAP_MAPPING, graph.sourceNodeA, TARGET_HEAP_START),
    ],
    objects: [
      debugMemoryObject(
        bundle,
        graph.dataMapping,
        ROOT_MAPPING,
        graph.sourcePointer,
        0,
        metadata.layouts.root,
      ),
      debugMemoryObject(
        bundle,
        graph.heapMapping,
        HEAP_MAPPING,
        graph.sourceNodeA,
        0,
        metadata.layouts.node,
      ),
      debugMemoryObject(
        bundle,
        graph.heapMapping,
        HEAP_MAPPING,
        graph.sourceNodeB,
        Number(NODE_STRIDE),
        metadata.layouts.node,
      ),
    ],
  };
}

function addressTranslation(id: string, sourceStart: bigint, targetStart: bigint) {
  return {
    id,
    sourceStart: finalJumpHex(sourceStart),
    sourceEnd: finalJumpHex(sourceStart + BigInt(FINAL_JUMP_PAGE_SIZE)),
    targetStart: finalJumpHex(targetStart),
  };
}

function debugMemoryObject(
  bundle: NativeProcessImageDocuments,
  mapping: NativeMemoryMapping,
  targetMapping: string,
  sourceStart: bigint,
  mappingOffset: number,
  layout: DebugPointerLayout,
) {
  return {
    id: layout.type,
    mapping: targetMapping,
    sourceStart: finalJumpHex(sourceStart),
    mappingOffset,
    fields: layout.fields
      .filter((field) => field.sizeBytes === 8)
      .map((field) => ({
        name: field.name,
        offset: field.offset,
        sizeBytes: field.sizeBytes,
        sourceValue: finalJumpHex(
          readCapturedU64(bundle, mapping, sourceStart + BigInt(field.offset)),
        ),
        classification: field.classification,
        metadata: "dwarf" as const,
      })),
  };
}

function assertScalarLookalikesPreserved(
  relocations: ReturnType<typeof translateNativeMemory>["relocations"],
) {
  const relocatedScalar = relocations.find(
    (relocation) =>
      (relocation.mapping === ROOT_MAPPING && relocation.offset === 32) ||
      (relocation.mapping === HEAP_MAPPING && relocation.offset === 24),
  );
  assert(!relocatedScalar, "DWARF scalar lookalike was incorrectly relocated as a pointer");
}

function extractDebugPointerContinuation(
  targetBinary: string,
  binDir: string,
): DebugPointerContinuation {
  const symbols = readSymbols(targetBinary, [ACTIVE_SYMBOL, RETURN_SYMBOL]);
  const active = symbols.get(ACTIVE_SYMBOL);
  const landing = symbols.get(RETURN_SYMBOL);
  assert(active?.sizeBytes, `target symbol ${ACTIVE_SYMBOL} is missing size metadata`);
  assert(landing?.sizeBytes, `target symbol ${RETURN_SYMBOL} is missing size metadata`);
  const returnOffset = Number(BigInt(landing.address) - BigInt(active.address));
  assert(returnOffset > 0, `${RETURN_SYMBOL} must follow ${ACTIVE_SYMBOL}`);
  const sectionPath = join(binDir, "machinen-debug-pointer-resume.bin");
  runCommand("objcopy", ["--dump-section", `${TARGET_SECTION}=${sectionPath}`, targetBinary], {
    label: "debug pointer continuation section extract",
  });
  const sectionBytes = readFileSync(sectionPath);
  const bytes = sectionBytes.subarray(0, returnOffset + landing.sizeBytes);
  assert(bytes.length >= returnOffset + landing.sizeBytes, `${TARGET_SECTION} truncated symbols`);
  return {
    binary: targetBinary,
    buildId: sha256File(targetBinary),
    activeSymbolSizeBytes: active.sizeBytes,
    returnSymbolSizeBytes: landing.sizeBytes,
    returnOffset,
    bytes,
  };
}

function codeMapInput(
  graph: DebugPointerFacts,
  continuation: DebugPointerContinuation,
  translatedReturnAddress: bigint,
) {
  return {
    expectedTargetBuildId: continuation.buildId,
    targetBuildId: continuation.buildId,
    sourceSymbols: [
      sourceSymbol(ACTIVE_SYMBOL, graph.textMapping.id, finalJumpHex(graph.sourcePc)),
      sourceSymbol(RETURN_SYMBOL, graph.textMapping.id, finalJumpHex(graph.sourceReturnAddress)),
    ],
    targetSymbols: [
      targetSymbol(
        ACTIVE_SYMBOL,
        continuation.activeSymbolSizeBytes,
        finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
        continuation.buildId,
      ),
      targetSymbol(
        RETURN_SYMBOL,
        continuation.returnSymbolSizeBytes,
        finalJumpHex(translatedReturnAddress),
        continuation.buildId,
      ),
    ],
    requestedLocations: [
      {
        id: "code:debug-pointer-active",
        symbol: ACTIVE_SYMBOL,
        sourceAddress: finalJumpHex(graph.sourcePc),
      },
      {
        id: "code:debug-pointer-return",
        symbol: RETURN_SYMBOL,
        sourceAddress: finalJumpHex(graph.sourceReturnAddress),
      },
    ],
  };
}

function sourceSymbol(name: string, mapping: string, address: string) {
  return { name, mapping, address, sizeBytes: 64, metadata: "dwarf" as const };
}

function targetSymbol(name: string, sizeBytes: number, address: string, buildId: string) {
  return {
    name,
    mapping: TARGET_TEXT_MAPPING,
    address,
    sizeBytes,
    buildId,
    metadata: "symbol" as const,
  };
}

function translatedMappingsDocument(
  graph: DebugPointerFacts,
  continuation: DebugPointerContinuation,
) {
  return {
    formatVersion: 1,
    mappings: [
      translatedOmittedSourceTextMapping(
        graph.textMapping,
        "source text is replaced by amd64 debug-pointer target text",
      ),
      translatedTargetTextMapping({
        id: TARGET_TEXT_MAPPING,
        binary: continuation.binary,
        buildId: continuation.buildId,
        targetStart: FINAL_JUMP_TARGET_TEXT_START,
        sizeBytes: FINAL_JUMP_PAGE_SIZE,
      }),
      translatedRootMapping(graph),
      translatedHeapMapping(graph),
      translatedCapturedStackMapping(graph.stackMapping),
    ],
    refusals: nativeEmptyRefusals(),
  };
}

function translatedRootMapping(graph: DebugPointerFacts) {
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

function translatedHeapMapping(graph: DebugPointerFacts) {
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

function debugPointerBundleMemory(
  textMarker: string,
  targetText: Buffer,
  graph: DebugPointerFacts,
) {
  const text = Buffer.alloc(FINAL_JUMP_PAGE_SIZE);
  text.write(textMarker, 0, "utf8");
  assert(
    targetText.length <= FINAL_JUMP_PAGE_SIZE - 128,
    "debug-pointer target text does not fit in final-jump text page",
  );
  targetText.copy(text, 128);
  return Buffer.concat([text, targetRootPage(graph), targetHeapPage(graph)]);
}

function targetRootPage(graph: DebugPointerFacts) {
  const root = Buffer.alloc(FINAL_JUMP_PAGE_SIZE);
  root.writeBigUInt64LE(FINAL_JUMP_TARGET_DATA_START, 0);
  root.writeBigUInt64LE(0x534f555243454a50n, 8);
  root.writeBigUInt64LE(TARGET_HEAP_START, 16);
  root.writeBigUInt64LE(2n, 24);
  root.writeBigUInt64LE(graph.sourceRootScalarLookalike, 32);
  root.writeBigUInt64LE(DEBUG_GRAPH_CHECKSUM, 40);
  root.writeBigUInt64LE(0n, 48);
  return root;
}

function targetHeapPage(graph: DebugPointerFacts) {
  const heap = Buffer.alloc(FINAL_JUMP_PAGE_SIZE);
  heap.writeBigUInt64LE(NODE_MAGIC_A, 0);
  heap.writeBigUInt64LE(NODE_VALUE_A, 8);
  heap.writeBigUInt64LE(TARGET_HEAP_START + NODE_STRIDE, 16);
  heap.writeBigUInt64LE(graph.sourceNodeScalarLookalike, 24);
  const nodeBOffset = Number(NODE_STRIDE);
  heap.writeBigUInt64LE(NODE_MAGIC_B, nodeBOffset);
  heap.writeBigUInt64LE(NODE_VALUE_B, nodeBOffset + 8);
  heap.writeBigUInt64LE(0n, nodeBOffset + 16);
  heap.writeBigUInt64LE(0n, nodeBOffset + 24);
  return heap;
}

function validateMetadataCoversGraph(metadata: DebugPointerMetadata, graph: DebugPointerFacts) {
  assert(
    pointerFieldNames(metadata).includes("NativeDebugPointerRoot.head"),
    "root head not typed as pointer",
  );
  assert(
    pointerFieldNames(metadata).includes("NativeDebugPointerNode.next"),
    "node next not typed as pointer",
  );
  assert(
    scalarFieldNames(metadata).includes("NativeDebugPointerRoot.scalar_lookalike"),
    "root scalar lookalike was not typed as integer",
  );
  assert(graph.sourceRootScalarLookalike === graph.sourceNodeA, "root scalar lookalike changed");
}

function pointerFieldNames(metadata: DebugPointerMetadata) {
  return layoutFieldNames(metadata, "pointer");
}

function scalarFieldNames(metadata: DebugPointerMetadata) {
  return layoutFieldNames(metadata, "integer");
}

function layoutFieldNames(metadata: DebugPointerMetadata, classification: "integer" | "pointer") {
  return Object.values(metadata.layouts).flatMap((layout) =>
    layout.fields
      .filter((field) => field.classification === classification && field.sizeBytes === 8)
      .map((field) => `${layout.type}.${field.name}`),
  );
}

function readDebugPointerMetadataFile(sourceBundleDir: string): DebugPointerMetadata {
  return JSON.parse(readFileSync(join(sourceBundleDir, DEBUG_METADATA_FILE), "utf8"));
}

function readDebugPointerMetadata(target: string): DebugPointerMetadata {
  const stdout = runCommand("readelf", ["--debug-dump=info", target], {
    label: "debug pointer DWARF scan",
  }).stdout;
  const model = parseDwarfInfo(stdout);
  const producer = dwarfProducer(model.dies);
  return {
    formatVersion: 1,
    producer,
    layouts: {
      root: structLayout(model, "NativeDebugPointerRoot"),
      node: structLayout(model, "NativeDebugPointerNode"),
    },
  };
}

function parseDwarfInfo(stdout: string) {
  const roots: DwarfDie[] = [];
  const byOffset = new Map<string, DwarfDie>();
  const stack: DwarfDie[] = [];
  let current: DwarfDie | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const die =
      /^\s*<(\d+)><([0-9a-fA-F]+)>:\s+Abbrev Number:\s+\d+(?:\s+\((DW_TAG_[^)]+)\))?/.exec(line);
    if (die?.[3]) {
      current = addDwarfDie(roots, byOffset, stack, Number(die[1]), die[2], die[3]);
      continue;
    }
    const attr = /^\s*<[^>]+>\s+(DW_AT_[^\s:]+)\s*:\s+(.*)$/.exec(line);
    if (attr?.[1] && current) {
      current.attrs.set(attr[1], attr[2].trim());
    }
  }
  return { roots, byOffset, dies: [...byOffset.values()] };
}

function addDwarfDie(
  roots: DwarfDie[],
  byOffset: Map<string, DwarfDie>,
  stack: DwarfDie[],
  level: number,
  offset: string,
  tag: string,
) {
  const node: DwarfDie = {
    level,
    offset: normalizeDwarfOffset(offset),
    tag,
    attrs: new Map(),
    children: [],
  };
  const parent = level > 0 ? stack[level - 1] : undefined;
  if (parent) {
    parent.children.push(node);
  } else {
    roots.push(node);
  }
  stack[level] = node;
  stack.length = level + 1;
  byOffset.set(node.offset, node);
  return node;
}

function dwarfProducer(dies: DwarfDie[]) {
  const producer = dies.find((die) => die.attrs.has("DW_AT_producer"));
  return producer ? parseDwarfString(producer.attrs.get("DW_AT_producer") ?? "unknown") : "unknown";
}

function structLayout(model: ReturnType<typeof parseDwarfInfo>, name: string): DebugPointerLayout {
  const type = model.dies.find(
    (die) => die.tag === "DW_TAG_structure_type" && dwarfName(die) === name,
  );
  assert(type, `missing DWARF struct type: ${name}`);
  return {
    type: name,
    byteSize: parseDwarfInteger(requireAttr(type, "DW_AT_byte_size")),
    fields: type.children
      .filter((child) => child.tag === "DW_TAG_member")
      .map((member) => memberLayout(model.byOffset, member))
      .sort((left, right) => left.offset - right.offset),
  };
}

function memberLayout(byOffset: Map<string, DwarfDie>, member: DwarfDie): DebugPointerFieldLayout {
  const typeRef = parseDwarfRef(requireAttr(member, "DW_AT_type"));
  return {
    name: parseDwarfName(member),
    offset: member.attrs.has("DW_AT_data_member_location")
      ? parseDwarfInteger(member.attrs.get("DW_AT_data_member_location") ?? "0")
      : 0,
    sizeBytes: typeSize(byOffset, typeRef),
    type: describeType(byOffset, typeRef),
    classification: isPointerType(byOffset, typeRef) ? "pointer" : "integer",
  };
}

const TYPE_MODIFIER_TAGS = new Set([
  "DW_TAG_const_type",
  "DW_TAG_volatile_type",
  "DW_TAG_restrict_type",
  "DW_TAG_typedef",
]);

function describeType(
  byOffset: Map<string, DwarfDie>,
  ref: string,
  seen = new Set<string>(),
): string {
  const type = requireType(byOffset, ref);
  if (seen.has(ref)) {
    return dwarfName(type) ?? type.tag;
  }
  seen.add(ref);
  if (type.tag === "DW_TAG_pointer_type") {
    return `${type.attrs.has("DW_AT_type") ? describeType(byOffset, parseDwarfRef(requireAttr(type, "DW_AT_type")), seen) : "void"} *`;
  }
  if (type.tag === "DW_TAG_array_type") {
    return `${describeType(byOffset, parseDwarfRef(requireAttr(type, "DW_AT_type")), seen)}[]`;
  }
  if (TYPE_MODIFIER_TAGS.has(type.tag)) {
    return describeType(byOffset, parseDwarfRef(requireAttr(type, "DW_AT_type")), seen);
  }
  if (type.tag === "DW_TAG_structure_type") {
    return `struct ${dwarfName(type) ?? "<anonymous>"}`;
  }
  return dwarfName(type) ?? type.tag;
}

function typeSize(byOffset: Map<string, DwarfDie>, ref: string, seen = new Set<string>()): number {
  const type = requireType(byOffset, ref);
  if (type.attrs.has("DW_AT_byte_size")) {
    return parseDwarfInteger(type.attrs.get("DW_AT_byte_size") ?? "0");
  }
  if (seen.has(ref)) {
    throw new Error(`recursive DWARF type size: ${ref}`);
  }
  seen.add(ref);
  if (TYPE_MODIFIER_TAGS.has(type.tag) || type.tag === "DW_TAG_array_type") {
    const elementSize = typeSize(byOffset, parseDwarfRef(requireAttr(type, "DW_AT_type")), seen);
    return type.tag === "DW_TAG_array_type" ? elementSize * arrayElementCount(type) : elementSize;
  }
  throw new Error(`DWARF type has no size: ${type.tag} ${ref}`);
}

function arrayElementCount(type: DwarfDie) {
  const subrange = type.children.find((child) => child.tag === "DW_TAG_subrange_type");
  assert(subrange, `array type ${type.offset} has no subrange`);
  if (subrange.attrs.has("DW_AT_count")) {
    return parseDwarfInteger(subrange.attrs.get("DW_AT_count") ?? "0");
  }
  if (subrange.attrs.has("DW_AT_upper_bound")) {
    return parseDwarfInteger(subrange.attrs.get("DW_AT_upper_bound") ?? "0") + 1;
  }
  throw new Error(`array type ${type.offset} has no count or upper bound`);
}

function isPointerType(
  byOffset: Map<string, DwarfDie>,
  ref: string,
  seen = new Set<string>(),
): boolean {
  const type = requireType(byOffset, ref);
  if (type.tag === "DW_TAG_pointer_type") {
    return true;
  }
  if (seen.has(ref) || !TYPE_MODIFIER_TAGS.has(type.tag)) {
    return false;
  }
  seen.add(ref);
  return isPointerType(byOffset, parseDwarfRef(requireAttr(type, "DW_AT_type")), seen);
}

function dwarfName(die: DwarfDie) {
  return die.attrs.has("DW_AT_name")
    ? parseDwarfString(die.attrs.get("DW_AT_name") ?? "")
    : undefined;
}

function parseDwarfName(die: DwarfDie) {
  const name = dwarfName(die);
  assert(name !== undefined, `missing DW_AT_name on ${die.tag} ${die.offset}`);
  return name;
}

function parseDwarfString(raw: string) {
  const value = String(raw).trim();
  const indirect = /\):\s*(.*)$/.exec(value);
  if (indirect?.[1]) {
    return indirect[1].trim();
  }
  const lineString = /^\([^)]*\)\s*(.*)$/.exec(value);
  return lineString?.[1] ? lineString[1].trim() : value;
}

function parseDwarfRef(raw: string) {
  const match = /<0x([0-9a-fA-F]+)>/.exec(String(raw));
  assert(match?.[1], `missing DWARF reference in ${raw}`);
  return normalizeDwarfOffset(match[1]);
}

function parseDwarfInteger(raw: string) {
  const text = String(raw).trim();
  const afterForm = /\)\s*(0x[0-9a-fA-F]+|\d+)\s*$/.exec(text);
  if (afterForm?.[1]) {
    return Number.parseInt(afterForm[1], 0);
  }
  const plusUconst = /DW_OP_plus_uconst:\s*(0x[0-9a-fA-F]+|\d+)/.exec(text);
  if (plusUconst?.[1]) {
    return Number.parseInt(plusUconst[1], 0);
  }
  const match = /^(?:[^0-9a-fA-F]*)(0x[0-9a-fA-F]+|\d+)/.exec(text);
  assert(match?.[1], `missing integer in ${raw}`);
  return Number.parseInt(match[1], 0);
}

function normalizeDwarfOffset(offset: string) {
  return `0x${offset.replace(/^0x/i, "").toLowerCase()}`;
}

function requireAttr(die: DwarfDie, attr: string) {
  const value = die.attrs.get(attr);
  assert(value !== undefined, `missing ${attr} on ${die.tag} ${die.offset}`);
  return value;
}

function requireType(byOffset: Map<string, DwarfDie>, ref: string) {
  const type = byOffset.get(ref);
  assert(type, `missing DWARF type ${ref}`);
  return type;
}

function printSummary(summary: NativeDwarfPointerClassificationSummary) {
  if ("skipped" in summary) {
    console.log(`native-dwarf-pointer-classification: skip — ${summary.reason}`);
    return;
  }
  console.log(
    `native-dwarf-pointer-classification: phase=${summary.phase} root=${summary.capturedSourcePointer} nodeA=${summary.sourceNodeA}`,
  );
  console.log(`native-dwarf-pointer-classification: execution=${summary.execution}`);
}

main();
