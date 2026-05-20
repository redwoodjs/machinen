#!/usr/bin/env tsx
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildNativeCodeMap } from "../packages/runtime/src/native-code-map.ts";
import { translateNativeMemory } from "../packages/runtime/src/native-memory-translation.ts";
import {
  validateNativeProcessImageBundle,
  type NativeMemoryMapping,
} from "../packages/runtime/src/native-process-image.ts";
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import { translateNativeStack } from "../packages/runtime/src/native-stack-translation.ts";
import {
  NATIVE_CALL_FRAME_CONTINUATION_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  NATIVE_RESUME_TRAMPOLINE_SOURCE,
  bundleFileStats,
  compileNativeCallFrameContinuation,
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
  FINAL_JUMP_PAGE_SIZE,
  FINAL_JUMP_RETURN_MARKER,
  FINAL_JUMP_TARGET_DATA_START,
  FINAL_JUMP_TARGET_ENTRY,
  FINAL_JUMP_TARGET_TEXT_START,
  finalJumpBundleMemoryFromTargetText,
  finalJumpHex,
  jumpIntoFinalTargetNativeCode,
  requireFinalJumpAmd64Registers,
  validateFinalJumpReturnChainResumeEvent,
} from "./native-final-jump-utils.ts";
import {
  assertCapturedTranslationSteps,
  captureNativeArm64SourceBundle,
  capturedMemoryInput,
  capturedRegisterInput,
  capturedStackInput,
  inspectCapturedArm64Source,
  translatedCapturedManifest,
  translatedCapturedStackMapping,
  translatedCapturedStateMapping,
  translatedThreads,
  type CapturedArm64SourceFacts,
} from "./native-captured-source-utils.ts";

const USAGE =
  "usage: tsx scripts/native-call-frame-final-jump.ts [verify] [--out-dir path] [--json] [--keep]";
const SOURCE_BUNDLE_ENV = "MACHINEN_NATIVE_CALL_FRAME_SOURCE_BUNDLE";
const TEXT_MARKER = "machinen-native-call-frame-final-jump-v1";
const ACTIVE_SYMBOL = "machinen_native_call_frame_active";
const RETURN_SYMBOL = "machinen_native_call_frame_return";
const TARGET_SECTION = ".machinen_resume";
const TRANSLATED_STATE_MAPPING = "mapping:call-frame-state";
const TARGET_TEXT_MAPPING = "mapping:amd64-call-frame-text";

interface CallFrameContinuation {
  binary: string;
  buildId: string;
  activeSymbolAddress: string;
  returnSymbolAddress: string;
  activeSymbolSizeBytes: number;
  returnSymbolSizeBytes: number;
  returnOffset: number;
  bytes: Buffer;
}

type NativeCallFrameFinalJumpSummary =
  | ReturnType<typeof captureArm64Source>
  | ReturnType<typeof translateAndJumpCallFrame>
  | ReturnType<typeof sourceBundleOnArm64Skip>
  | ReturnType<typeof missingBundleSkip>
  | ReturnType<typeof unsupportedHostSkip>;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "native-call-frame-final-jump",
      "captured call-frame final jump uses Linux ptrace/procfs",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-native-call-frame-final-jump-");
  try {
    emitResult(verifyNativeCallFrameFinalJump(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeCallFrameFinalJump(outDir: string): NativeCallFrameFinalJumpSummary {
  const sourceBundle = process.env[SOURCE_BUNDLE_ENV];
  const handlers: Record<string, () => NativeCallFrameFinalJumpSummary> = {
    arm64: () => (sourceBundle ? sourceBundleOnArm64Skip() : captureArm64Source(outDir)),
    x64: () =>
      sourceBundle ? translateAndJumpCallFrame(outDir, resolve(sourceBundle)) : missingBundleSkip(),
  };
  return (handlers[process.arch] ?? unsupportedHostSkip)();
}

function sourceBundleOnArm64Skip() {
  return { skipped: true, reason: `${SOURCE_BUNDLE_ENV} is only consumed on Linux/amd64` };
}

function missingBundleSkip() {
  return {
    skipped: true,
    reason: `${SOURCE_BUNDLE_ENV} must point at an arm64 source bundle for the amd64 call-frame final jump`,
  };
}

function unsupportedHostSkip() {
  return { skipped: true, reason: `unsupported host architecture: ${process.arch}` };
}

function captureArm64Source(outDir: string) {
  const { sourceBundleDir, capturer, target, sourceBundle, facts } = captureNativeArm64SourceBundle(
    {
      outDir,
      targetSource: NATIVE_CALL_FRAME_CONTINUATION_SOURCE,
      compileTarget: compileNativeCallFrameContinuation,
      resourceFileName: "native-call-frame-resource.txt",
      label: "native call-frame source capture",
    },
  );
  const sourceReturnAddress = capturedArm64ReturnAddress(facts);
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
    capturedSourceReturnAddress: finalJumpHex(sourceReturnAddress),
    sourceInitialWord0: finalJumpHex(facts.sourceInitialWord0),
    sourceMarker: finalJumpHex(facts.sourceMarker),
    textMapping: facts.textMapping.id,
    dataMapping: facts.dataMapping.id,
    stackMapping: facts.stackMapping.id,
    execution: "captured-arm64-source-awaiting-amd64-call-frame-final-jump",
    bundleFiles: bundleFileStats(sourceBundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function translateAndJumpCallFrame(outDir: string, sourceBundleDir: string) {
  ensureSourcesExist([NATIVE_RESUME_TRAMPOLINE_SOURCE, NATIVE_CALL_FRAME_CONTINUATION_SOURCE]);
  const sourceBundle = validateNativeProcessImageBundle(sourceBundleDir);
  const facts = inspectCapturedArm64Source(sourceBundle);
  const sourceReturnAddress = capturedArm64ReturnAddress(facts);
  const binDir = join(outDir, "bin");
  const bundleDir = join(outDir, "bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });

  const trampoline = compileNativeResumeTrampoline(binDir);
  const targetBinary = compileNativeCallFrameContinuation(binDir);
  const continuation = extractCallFrameContinuation(targetBinary, binDir);
  const translatedReturnAddress = FINAL_JUMP_TARGET_ENTRY + BigInt(continuation.returnOffset);
  const codeMap = buildNativeCodeMap(
    codeMapInput(facts, sourceReturnAddress, continuation, translatedReturnAddress),
  );
  const stack = translateNativeStack(
    capturedStackInput(
      facts,
      codeMap.codeLocations,
      "frame:captured-call-frame-active",
      sourceReturnAddress,
    ),
  );
  const registers = translateNativeRegisterState(
    capturedRegisterInput(facts, FINAL_JUMP_TARGET_ENTRY),
  );
  const memory = translateNativeMemory(capturedMemoryInput(facts, TRANSLATED_STATE_MAPPING));
  const resources = translateNativeResources({ resources: sourceBundle.resources.resources });
  assertCapturedTranslationSteps({ codeMap, registers, stack, memory }, "call-frame final-jump");

  const stackReturnAddress = translatedStackReturnAddress(stack);
  assert(
    stackReturnAddress === translatedReturnAddress,
    "translated stack return address did not match target-binary return symbol",
  );
  writeNativeProcessImageBundle(
    bundleDir,
    nativeProofBundleDocuments(
      finalJumpBundleMemoryFromTargetText(
        TEXT_MARKER,
        continuation.bytes,
        FINAL_JUMP_TARGET_DATA_START,
      ),
      translatedCapturedManifest(sourceBundle),
      translatedMappings(facts, continuation),
      translatedThreads(facts),
      resources.resources,
      { codeMap, registers, stack, memory, resources },
      { vocabularyVersion: 1, refusals: resources.refusals },
    ),
  );
  const translatedBundle = validateNativeProcessImageBundle(bundleDir);
  const targetRegisters = requireFinalJumpAmd64Registers(
    registers.threads[0],
    "call-frame-final-jump",
  );
  const resumeEvent = jumpIntoFinalTargetNativeCode({
    label: "call-frame-final-jump",
    trampoline,
    bundleDir,
    targetRegisters,
    textMarker: TEXT_MARKER,
    expectedInitialDataWord0: FINAL_JUMP_TARGET_DATA_START,
    translatedReturnAddress,
    expectedReturnMarker: FINAL_JUMP_RETURN_MARKER,
  });
  validateFinalJumpReturnChainResumeEvent(
    resumeEvent,
    "native call-frame final jump",
    translatedReturnAddress,
  );

  return {
    formatVersion: 1,
    phase: "call-frame-final-jump",
    hostArch: "amd64",
    sourceBundleDir,
    bundleDir,
    trampoline,
    targetBinary: continuation.binary,
    targetBuildId: continuation.buildId,
    activeSymbol: ACTIVE_SYMBOL,
    returnSymbol: RETURN_SYMBOL,
    activeSymbolAddress: continuation.activeSymbolAddress,
    returnSymbolAddress: continuation.returnSymbolAddress,
    sourcePid: sourceBundle.manifest.capture.pid,
    sourceExe: sourceBundle.manifest.process.exe,
    threadId: facts.thread.id,
    capturedSourcePc: finalJumpHex(facts.sourcePc),
    capturedSourcePointer: finalJumpHex(facts.sourcePointer),
    capturedSourceReturnAddress: finalJumpHex(sourceReturnAddress),
    translatedEntry: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    translatedReturnAddress: finalJumpHex(translatedReturnAddress),
    translatedArgument: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
    codeLocations: codeMap.codeLocations.length,
    stackRelocations: stack.relocations.length,
    memoryRelocations: memory.relocations.length,
    execution: "captured-arm64-source-returned-through-matching-amd64-target-binary-frame",
    resumeEvent,
    bundleTargetArch: translatedBundle.manifest.target.arch,
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function extractCallFrameContinuation(targetBinary: string, binDir: string): CallFrameContinuation {
  const symbols = readSymbols(targetBinary, [ACTIVE_SYMBOL, RETURN_SYMBOL]);
  const active = symbols.get(ACTIVE_SYMBOL);
  const landing = symbols.get(RETURN_SYMBOL);
  assert(active, `target binary symbol missing: ${ACTIVE_SYMBOL}`);
  assert(landing, `target binary symbol missing: ${RETURN_SYMBOL}`);
  assert(active.sizeBytes > 0, `target binary symbol ${ACTIVE_SYMBOL} has no size metadata`);
  assert(landing.sizeBytes > 0, `target binary symbol ${RETURN_SYMBOL} has no size metadata`);
  const activeAddress = BigInt(active.address);
  const landingAddress = BigInt(landing.address);
  assert(landingAddress > activeAddress, `${RETURN_SYMBOL} must follow ${ACTIVE_SYMBOL}`);
  const returnOffset = Number(landingAddress - activeAddress);
  const sectionPath = join(binDir, "machinen-call-frame-resume.bin");
  runCommand("objcopy", ["--dump-section", `${TARGET_SECTION}=${sectionPath}`, targetBinary], {
    label: "call-frame continuation section extract",
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

function capturedArm64ReturnAddress(facts: CapturedArm64SourceFacts) {
  const sourceReturnAddress = BigInt(facts.thread.sourceRegisters.x[30] ?? "0x0");
  assert(sourceReturnAddress !== 0n, "captured arm64 x30 did not hold a return address");
  assert(
    sourceReturnAddress !== facts.sourcePc,
    "captured arm64 return address did not differ from the active PC",
  );
  return sourceReturnAddress;
}

function codeMapInput(
  facts: CapturedArm64SourceFacts,
  sourceReturnAddress: bigint,
  continuation: CallFrameContinuation,
  translatedReturnAddress: bigint,
) {
  return {
    expectedTargetBuildId: continuation.buildId,
    targetBuildId: continuation.buildId,
    sourceSymbols: [
      {
        name: ACTIVE_SYMBOL,
        mapping: facts.textMapping.id,
        address: finalJumpHex(facts.sourcePc),
        sizeBytes: 64,
        metadata: "sidecar" as const,
      },
      {
        name: RETURN_SYMBOL,
        mapping: facts.textMapping.id,
        address: finalJumpHex(sourceReturnAddress),
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
        id: "code:captured-call-frame-active",
        symbol: ACTIVE_SYMBOL,
        sourceAddress: finalJumpHex(facts.sourcePc),
      },
      {
        id: "code:captured-call-frame-return",
        symbol: RETURN_SYMBOL,
        sourceAddress: finalJumpHex(sourceReturnAddress),
      },
    ],
  };
}

function translatedMappings(facts: CapturedArm64SourceFacts, continuation: CallFrameContinuation) {
  return {
    formatVersion: 1,
    mappings: [
      translatedSourceTextMapping(facts.textMapping),
      translatedTextMapping(continuation),
      translatedCapturedStateMapping(facts, TRANSLATED_STATE_MAPPING),
      translatedCapturedStackMapping(facts.stackMapping),
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
      reason: "source arm64 text is replaced by matching amd64 call-frame target text",
    },
  };
}

function translatedTextMapping(continuation: CallFrameContinuation) {
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

function translatedStackReturnAddress(stack: ReturnType<typeof translateNativeStack>) {
  const relocation = stack.relocations.find((candidate) => candidate.kind === "return-address");
  assert(relocation?.targetValue, "stack translation did not produce a target return address");
  return BigInt(relocation.targetValue);
}

function printSummary(summary: ReturnType<typeof verifyNativeCallFrameFinalJump>) {
  if ("skipped" in summary) {
    console.log(`native-call-frame-final-jump: skip — ${summary.reason}`);
    return;
  }
  console.log(
    `native-call-frame-final-jump: phase=${summary.phase} sourcePc=${summary.capturedSourcePc} sourceReturn=${summary.capturedSourceReturnAddress}`,
  );
  console.log(`native-call-frame-final-jump: execution=${summary.execution}`);
}

main();
