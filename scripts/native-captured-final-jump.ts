#!/usr/bin/env tsx
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildNativeCodeMap } from "../packages/runtime/src/native-code-map.ts";
import { translateNativeMemory } from "../packages/runtime/src/native-memory-translation.ts";
import {
  validateNativeProcessImageBundle,
  type NativeArm64Registers,
  type NativeMemoryMapping,
  type NativeProcessImageDocuments,
  type NativeThreadState,
} from "../packages/runtime/src/native-process-image.ts";
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import { translateNativeStack } from "../packages/runtime/src/native-stack-translation.ts";
import {
  NATIVE_CAPTURE_SOURCE,
  NATIVE_FINAL_JUMP_SOURCE_TARGET_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  NATIVE_RESUME_TRAMPOLINE_SOURCE,
  bundleFileStats,
  compileNativeFinalJumpSourceTarget,
  compileNativeProcessCapturer,
  compileNativeResumeTrampoline,
  ensureSourcesExist,
  nativeEmptyRefusals,
  nativeProofBundleDocuments,
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
  FINAL_JUMP_STACK_SIZE,
  FINAL_JUMP_TARGET_DATA_START,
  FINAL_JUMP_TARGET_ENTRY,
  FINAL_JUMP_TARGET_STACK_POINTER,
  FINAL_JUMP_TARGET_STACK_START,
  FINAL_JUMP_TARGET_TEXT_START,
  finalJumpBundleMemory,
  finalJumpHex,
  jumpIntoFinalTargetNativeCode,
  requireFinalJumpAmd64Registers,
  validateFinalJumpResumeEvent,
} from "./native-final-jump-utils.ts";

const USAGE =
  "usage: tsx scripts/native-captured-final-jump.ts [verify] [--out-dir path] [--json] [--keep]";
const SOURCE_BUNDLE_ENV = "MACHINEN_NATIVE_CAPTURED_FINAL_JUMP_SOURCE_BUNDLE";
const TEXT_MARKER = "machinen-native-captured-final-jump-v1";
const TARGET_BUILD_ID = "46646646";
const SOURCE_STATE_MARKER = 0x534f555243454a50n;
const CAPTURE_SETTLE_MS = "200";
const TRANSLATED_STATE_MAPPING = "mapping:captured-state";

interface CapturedSourceFacts {
  thread: NativeThreadState & { sourceRegisters: NativeArm64Registers };
  sourcePc: bigint;
  sourceSp: bigint;
  sourcePointer: bigint;
  textMapping: NativeMemoryMapping;
  dataMapping: NativeMemoryMapping;
  stackMapping: NativeMemoryMapping;
  sourceInitialWord0: bigint;
  sourceMarker: bigint;
}

type NativeCapturedFinalJumpSummary =
  | ReturnType<typeof captureArm64Source>
  | ReturnType<typeof translateAndJumpCapturedSource>
  | ReturnType<typeof sourceBundleOnArm64Skip>
  | ReturnType<typeof missingSourceBundleSkip>
  | ReturnType<typeof unsupportedHostSkip>;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "native-captured-final-jump",
      "captured native final jump uses Linux ptrace/procfs",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-native-captured-final-jump-");
  try {
    emitResult(verifyNativeCapturedFinalJump(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeCapturedFinalJump(outDir: string): NativeCapturedFinalJumpSummary {
  const sourceBundle = process.env[SOURCE_BUNDLE_ENV];
  const handlers: Record<string, () => NativeCapturedFinalJumpSummary> = {
    arm64: () => (sourceBundle ? sourceBundleOnArm64Skip() : captureArm64Source(outDir)),
    x64: () =>
      sourceBundle
        ? translateAndJumpCapturedSource(outDir, resolve(sourceBundle))
        : missingSourceBundleSkip(),
  };
  return (handlers[process.arch] ?? unsupportedHostSkip)();
}

function sourceBundleOnArm64Skip() {
  return { skipped: true, reason: `${SOURCE_BUNDLE_ENV} is only consumed on Linux/amd64` };
}

function missingSourceBundleSkip() {
  return {
    skipped: true,
    reason: `${SOURCE_BUNDLE_ENV} must point at an arm64 source bundle for the amd64 final jump`,
  };
}

function unsupportedHostSkip() {
  return { skipped: true, reason: `unsupported host architecture: ${process.arch}` };
}

function captureArm64Source(outDir: string) {
  ensureSourcesExist([NATIVE_CAPTURE_SOURCE, NATIVE_FINAL_JUMP_SOURCE_TARGET_SOURCE]);
  const binDir = join(outDir, "bin");
  const sourceBundleDir = join(outDir, "source-bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(sourceBundleDir, { recursive: true });

  const capturer = compileNativeProcessCapturer(binDir);
  const target = compileNativeFinalJumpSourceTarget(binDir);
  const resourceFile = join(outDir, "native-captured-final-jump-resource.txt");
  runCommand(
    capturer,
    [
      "--output",
      sourceBundleDir,
      "--target-arch",
      "amd64",
      "--settle-ms",
      CAPTURE_SETTLE_MS,
      "--",
      target,
      "--resource-file",
      resourceFile,
    ],
    { label: "native captured final-jump source capture" },
  );

  const sourceBundle = validateNativeProcessImageBundle(sourceBundleDir);
  const facts = inspectCapturedSource(sourceBundle);
  return {
    formatVersion: 1,
    phase: "capture-source",
    hostArch: "arm64",
    sourceBundleDir,
    capturer,
    target,
    pid: sourceBundle.manifest.capture.pid,
    threadId: facts.thread.id,
    capturedSourcePc: finalJumpHex(facts.sourcePc),
    capturedSourcePointer: finalJumpHex(facts.sourcePointer),
    sourceInitialWord0: finalJumpHex(facts.sourceInitialWord0),
    sourceMarker: finalJumpHex(facts.sourceMarker),
    textMapping: facts.textMapping.id,
    dataMapping: facts.dataMapping.id,
    stackMapping: facts.stackMapping.id,
    execution: "captured-arm64-source-awaiting-amd64-final-jump",
    bundleFiles: bundleFileStats(sourceBundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function translateAndJumpCapturedSource(outDir: string, sourceBundleDir: string) {
  ensureSourcesExist([NATIVE_RESUME_TRAMPOLINE_SOURCE]);
  const sourceBundle = validateNativeProcessImageBundle(sourceBundleDir);
  const facts = inspectCapturedSource(sourceBundle);
  const binDir = join(outDir, "bin");
  const bundleDir = join(outDir, "bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });
  const trampoline = compileNativeResumeTrampoline(binDir);

  const codeMap = buildNativeCodeMap(codeMapInput(facts));
  const stack = translateNativeStack(stackInput(facts, codeMap.codeLocations));
  const registers = translateNativeRegisterState(registerInput(facts));
  const memory = translateNativeMemory(memoryInput(facts));
  const resources = translateNativeResources({ resources: sourceBundle.resources.resources });
  assertCoreTranslationSteps({ codeMap, registers, stack, memory });

  writeNativeProcessImageBundle(
    bundleDir,
    nativeProofBundleDocuments(
      finalJumpBundleMemory(TEXT_MARKER, FINAL_JUMP_TARGET_DATA_START),
      translatedManifest(sourceBundle),
      translatedMappings(facts),
      translatedThreads(facts),
      resources.resources,
      { codeMap, registers, stack, memory, resources },
      { vocabularyVersion: 1, refusals: resources.refusals },
    ),
  );
  const translatedBundle = validateNativeProcessImageBundle(bundleDir);
  const targetRegisters = requireFinalJumpAmd64Registers(
    registers.threads[0],
    "captured-final-jump",
  );
  const resumeEvent = jumpIntoFinalTargetNativeCode({
    label: "captured-final-jump",
    trampoline,
    bundleDir,
    targetRegisters,
    textMarker: TEXT_MARKER,
    expectedInitialDataWord0: FINAL_JUMP_TARGET_DATA_START,
  });
  validateFinalJumpResumeEvent(resumeEvent, "native captured final jump");

  return {
    formatVersion: 1,
    phase: "target-final-jump",
    hostArch: "amd64",
    sourceBundleDir,
    bundleDir,
    trampoline,
    sourcePid: sourceBundle.manifest.capture.pid,
    sourceExe: sourceBundle.manifest.process.exe,
    threadId: facts.thread.id,
    capturedSourcePc: finalJumpHex(facts.sourcePc),
    capturedSourcePointer: finalJumpHex(facts.sourcePointer),
    sourceInitialWord0: finalJumpHex(facts.sourceInitialWord0),
    translatedEntry: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    translatedArgument: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
    codeLocations: codeMap.codeLocations.length,
    registerThreads: registers.threads.length,
    stackRelocations: stack.relocations.length,
    memoryRelocations: memory.relocations.length,
    resourceRecipes: resources.resources.filter((resource) => resource.state === "recipe").length,
    resourceRefusals: resources.refusals,
    execution: "captured-arm64-source-jumped-target-native-amd64-code",
    resumeEvent,
    bundleTargetArch: translatedBundle.manifest.target.arch,
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function inspectCapturedSource(bundle: NativeProcessImageDocuments): CapturedSourceFacts {
  assert(
    bundle.manifest.capture.sourceArch === "arm64",
    "source bundle must be captured from arm64",
  );
  assert(bundle.manifest.target.arch === "amd64", "source bundle target arch must be amd64");
  const thread = bundle.threads.threads.find(
    (candidate): candidate is NativeThreadState & { sourceRegisters: NativeArm64Registers } =>
      candidate.sourceRegisters.arch === "arm64",
  );
  assert(thread, "source bundle has no arm64 thread");
  const sourcePc = BigInt(thread.sourceRegisters.pc);
  const sourceSp = BigInt(thread.sourceRegisters.sp);
  const sourcePointer = BigInt(thread.sourceRegisters.x[0] ?? "0x0");
  assert(sourcePointer !== 0n, "captured x0 did not hold a source data pointer");
  assert(
    sourcePointer % BigInt(FINAL_JUMP_PAGE_SIZE) === 0n,
    "captured source pointer is not page aligned",
  );

  const textMapping = mappingContaining(bundle, sourcePc, (mapping) => mapping.permissions.execute);
  const dataMapping = mappingContaining(
    bundle,
    sourcePointer,
    (mapping) => mapping.permissions.write,
  );
  const stackMapping = mappingById(bundle, thread.stackMapping);
  const sourceInitialWord0 = readCapturedU64(bundle, dataMapping, sourcePointer);
  const sourceMarker = readCapturedU64(bundle, dataMapping, sourcePointer + 8n);
  assert(
    sourceInitialWord0 === sourcePointer,
    "captured source state did not contain its self pointer",
  );
  assert(sourceMarker === SOURCE_STATE_MARKER, "captured source state marker did not match");

  return {
    thread,
    sourcePc,
    sourceSp,
    sourcePointer,
    textMapping,
    dataMapping,
    stackMapping,
    sourceInitialWord0,
    sourceMarker,
  };
}

function codeMapInput(facts: CapturedSourceFacts) {
  return {
    expectedTargetBuildId: TARGET_BUILD_ID,
    targetBuildId: TARGET_BUILD_ID,
    sourceSymbols: [
      {
        name: "native_captured_final_jump_resume",
        mapping: facts.textMapping.id,
        address: finalJumpHex(facts.sourcePc),
        sizeBytes: 64,
        metadata: "sidecar" as const,
      },
    ],
    targetSymbols: [
      {
        name: "native_captured_final_jump_resume",
        mapping: "mapping:amd64-text",
        address: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
        sizeBytes: 64,
        metadata: "sidecar" as const,
      },
    ],
    requestedLocations: [
      {
        id: "code:captured-resume",
        symbol: "native_captured_final_jump_resume",
        sourceAddress: finalJumpHex(facts.sourcePc),
      },
    ],
  };
}

function stackInput(
  facts: CapturedSourceFacts,
  codeLocations: ReturnType<typeof buildNativeCodeMap>["codeLocations"],
) {
  return {
    stackMapping: facts.stackMapping.id,
    targetStackBase: finalJumpHex(FINAL_JUMP_TARGET_STACK_START + BigInt(FINAL_JUMP_STACK_SIZE)),
    codeLocations,
    frames: [
      {
        id: "frame:captured-resume",
        sourceSp: finalJumpHex(facts.sourceSp),
        sourceReturnAddress: finalJumpHex(facts.sourcePc),
        sizeBytes: 64,
        metadata: "sidecar" as const,
        locals: [
          {
            offset: 16,
            kind: "pointer" as const,
            sourceValue: finalJumpHex(facts.sourcePointer),
            targetValue: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
          },
        ],
      },
    ],
  };
}

function registerInput(facts: CapturedSourceFacts) {
  return {
    sourceArch: "arm64" as const,
    targetArch: "amd64" as const,
    threads: [facts.thread],
    continuations: {
      [facts.thread.id]: {
        sourcePc: finalJumpHex(facts.sourcePc),
        targetIp: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
        targetSp: finalJumpHex(FINAL_JUMP_TARGET_STACK_POINTER),
        targetTls: "0x0",
        targetRegisterOverrides: { rdi: finalJumpHex(FINAL_JUMP_TARGET_DATA_START) },
      },
    },
  };
}

function memoryInput(facts: CapturedSourceFacts) {
  return {
    words: [
      {
        mapping: TRANSLATED_STATE_MAPPING,
        offset: 0,
        sourceValue: finalJumpHex(facts.sourceInitialWord0),
        targetValue: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
        classification: "pointer" as const,
        proof: "sidecar" as const,
      },
    ],
  };
}

function translatedManifest(sourceBundle: NativeProcessImageDocuments) {
  return {
    ...sourceBundle.manifest,
    target: {
      mode: "native-cross-isa" as const,
      arch: "amd64" as const,
      abi: "linux-user" as const,
    },
    refusals: nativeEmptyRefusals(),
  };
}

function translatedMappings(facts: CapturedSourceFacts) {
  return {
    formatVersion: 1,
    mappings: uniqueMappings([
      translatedTextMapping(facts.textMapping),
      translatedStateMapping(facts),
      translatedStackMapping(facts.stackMapping),
    ]),
    refusals: nativeEmptyRefusals(),
  };
}

function translatedTextMapping(mapping: NativeMemoryMapping) {
  return {
    id: mapping.id,
    kind: "text" as const,
    sourceStart: mapping.sourceStart,
    sourceEnd: mapping.sourceEnd,
    sizeBytes: mapping.sizeBytes,
    permissions: { read: true, write: false, execute: true, private: true, shared: false },
    file: mapping.file,
    captured: { file: "native-memory.bin" as const, offset: 0, sizeBytes: FINAL_JUMP_PAGE_SIZE },
    target: {
      materialization: "translate" as const,
      targetStart: finalJumpHex(FINAL_JUMP_TARGET_TEXT_START),
    },
  };
}

function translatedStateMapping(facts: CapturedSourceFacts) {
  return {
    id: TRANSLATED_STATE_MAPPING,
    kind: "data" as const,
    sourceStart: finalJumpHex(facts.sourcePointer),
    sourceEnd: finalJumpHex(facts.sourcePointer + BigInt(FINAL_JUMP_PAGE_SIZE)),
    sizeBytes: FINAL_JUMP_PAGE_SIZE,
    permissions: { read: true, write: true, execute: false, private: true, shared: false },
    file: facts.dataMapping.file,
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

function translatedStackMapping(mapping: NativeMemoryMapping) {
  return {
    id: mapping.id,
    kind: "stack" as const,
    sourceStart: mapping.sourceStart,
    sourceEnd: mapping.sourceEnd,
    sizeBytes: mapping.sizeBytes,
    permissions: { read: true, write: true, execute: false, private: true, shared: false },
    target: {
      materialization: "recreate" as const,
      targetStart: finalJumpHex(FINAL_JUMP_TARGET_STACK_START),
    },
  };
}

function translatedThreads(facts: CapturedSourceFacts) {
  return { formatVersion: 1, threads: [facts.thread], refusals: nativeEmptyRefusals() };
}

function uniqueMappings(mappings: NativeMemoryMapping[]): NativeMemoryMapping[] {
  const seen = new Set<string>();
  for (const mapping of mappings) {
    assert(!seen.has(mapping.id), `translated mapping id collision: ${mapping.id}`);
    seen.add(mapping.id);
  }
  return mappings;
}

function assertCoreTranslationSteps(steps: {
  codeMap: ReturnType<typeof buildNativeCodeMap>;
  registers: ReturnType<typeof translateNativeRegisterState>;
  stack: ReturnType<typeof translateNativeStack>;
  memory: ReturnType<typeof translateNativeMemory>;
}) {
  assert(steps.codeMap.refusals.length === 0, "captured final-jump code map refused unexpectedly");
  assert(
    steps.registers.refusals.length === 0,
    "captured final-jump registers refused unexpectedly",
  );
  assert(steps.stack.refusals.length === 0, "captured final-jump stack refused unexpectedly");
  assert(steps.memory.refusals.length === 0, "captured final-jump memory refused unexpectedly");
}

function mappingContaining(
  bundle: NativeProcessImageDocuments,
  address: bigint,
  predicate: (mapping: NativeMemoryMapping) => boolean,
) {
  const mapping = bundle.mappings.mappings.find(
    (candidate) =>
      predicate(candidate) &&
      address >= BigInt(candidate.sourceStart) &&
      address < BigInt(candidate.sourceEnd),
  );
  assert(mapping, `no captured mapping contains ${finalJumpHex(address)}`);
  return mapping;
}

function mappingById(bundle: NativeProcessImageDocuments, id: string) {
  const mapping = bundle.mappings.mappings.find((candidate) => candidate.id === id);
  assert(mapping, `source bundle references missing mapping ${id}`);
  return mapping;
}

function readCapturedU64(
  bundle: NativeProcessImageDocuments,
  mapping: NativeMemoryMapping,
  sourceAddress: bigint,
) {
  assert(bundle.rootDir, "source bundle root directory is missing");
  assert(mapping.captured, `mapping ${mapping.id} has no captured bytes`);
  const offsetInMapping = sourceAddress - BigInt(mapping.sourceStart);
  assert(offsetInMapping >= 0n, "captured read starts before mapping");
  assert(
    offsetInMapping + 8n <= BigInt(mapping.captured.sizeBytes),
    "captured read exceeds mapping bytes",
  );
  const memory = readFileSync(join(bundle.rootDir, "native-memory.bin"));
  const fileOffset = BigInt(mapping.captured.offset) + offsetInMapping;
  assert(fileOffset + 8n <= BigInt(memory.length), "captured read exceeds native-memory.bin");
  return memory.readBigUInt64LE(Number(fileOffset));
}

function printSummary(summary: ReturnType<typeof verifyNativeCapturedFinalJump>) {
  if ("skipped" in summary) {
    console.log(`native-captured-final-jump: skip — ${summary.reason}`);
    return;
  }
  console.log(
    `native-captured-final-jump: phase=${summary.phase} sourcePc=${summary.capturedSourcePc} sourcePtr=${summary.capturedSourcePointer}`,
  );
  console.log(`native-captured-final-jump: execution=${summary.execution}`);
}

main();
