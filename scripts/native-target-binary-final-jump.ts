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
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  NATIVE_RESUME_TRAMPOLINE_SOURCE,
  NATIVE_TARGET_BINARY_CONTINUATION_SOURCE,
  bundleFileStats,
  compileNativeResumeTrampoline,
  compileNativeTargetBinaryContinuation,
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
  FINAL_JUMP_TARGET_DATA_START,
  FINAL_JUMP_TARGET_ENTRY,
  FINAL_JUMP_TARGET_TEXT_START,
  finalJumpBundleMemoryFromTargetText,
  finalJumpHex,
  jumpIntoFinalTargetNativeCode,
  requireFinalJumpAmd64Registers,
  validateFinalJumpResumeEvent,
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
  "usage: tsx scripts/native-target-binary-final-jump.ts [verify] [--out-dir path] [--json] [--keep]";
const SOURCE_BUNDLE_ENV = "MACHINEN_NATIVE_TARGET_BINARY_SOURCE_BUNDLE";
const TEXT_MARKER = "machinen-native-target-binary-final-jump-v1";
const TARGET_SYMBOL = "machinen_native_target_binary_resume";
const TARGET_SECTION = ".machinen_resume";
const TRANSLATED_STATE_MAPPING = "mapping:target-binary-state";
const TARGET_TEXT_MAPPING = "mapping:amd64-target-binary-text";

interface TargetBinaryContinuation {
  binary: string;
  buildId: string;
  symbolAddress: string;
  symbolSizeBytes: number;
  bytes: Buffer;
}

type NativeTargetBinaryFinalJumpSummary =
  | ReturnType<typeof captureArm64Source>
  | ReturnType<typeof translateAndJumpTargetBinary>
  | ReturnType<typeof sourceBundleOnArm64Skip>
  | ReturnType<typeof missingBundleSkip>
  | ReturnType<typeof unsupportedHostSkip>;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "native-target-binary-final-jump",
      "captured target-binary final jump uses Linux ptrace/procfs",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-native-target-binary-final-jump-");
  try {
    emitResult(verifyNativeTargetBinaryFinalJump(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeTargetBinaryFinalJump(outDir: string): NativeTargetBinaryFinalJumpSummary {
  const sourceBundle = process.env[SOURCE_BUNDLE_ENV];
  const handlers: Record<string, () => NativeTargetBinaryFinalJumpSummary> = {
    arm64: () => (sourceBundle ? sourceBundleOnArm64Skip() : captureArm64Source(outDir)),
    x64: () =>
      sourceBundle
        ? translateAndJumpTargetBinary(outDir, resolve(sourceBundle))
        : missingBundleSkip(),
  };
  return (handlers[process.arch] ?? unsupportedHostSkip)();
}

function sourceBundleOnArm64Skip() {
  return { skipped: true, reason: `${SOURCE_BUNDLE_ENV} is only consumed on Linux/amd64` };
}

function missingBundleSkip() {
  return {
    skipped: true,
    reason: `${SOURCE_BUNDLE_ENV} must point at an arm64 source bundle for the amd64 target-binary final jump`,
  };
}

function unsupportedHostSkip() {
  return { skipped: true, reason: `unsupported host architecture: ${process.arch}` };
}

function captureArm64Source(outDir: string) {
  const { sourceBundleDir, capturer, target, sourceBundle, facts } = captureNativeArm64SourceBundle(
    {
      outDir,
      targetSource: NATIVE_TARGET_BINARY_CONTINUATION_SOURCE,
      compileTarget: compileNativeTargetBinaryContinuation,
      resourceFileName: "native-target-binary-resource.txt",
      label: "native target-binary source capture",
    },
  );
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
    execution: "captured-arm64-source-awaiting-amd64-target-binary-final-jump",
    bundleFiles: bundleFileStats(sourceBundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function translateAndJumpTargetBinary(outDir: string, sourceBundleDir: string) {
  ensureSourcesExist([NATIVE_RESUME_TRAMPOLINE_SOURCE, NATIVE_TARGET_BINARY_CONTINUATION_SOURCE]);
  const sourceBundle = validateNativeProcessImageBundle(sourceBundleDir);
  const facts = inspectCapturedArm64Source(sourceBundle);
  const binDir = join(outDir, "bin");
  const bundleDir = join(outDir, "bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });

  const trampoline = compileNativeResumeTrampoline(binDir);
  const targetBinary = compileNativeTargetBinaryContinuation(binDir);
  const continuation = extractTargetBinaryContinuation(targetBinary, binDir);
  const codeMap = buildNativeCodeMap(codeMapInput(facts, continuation));
  const stack = translateNativeStack(
    capturedStackInput(facts, codeMap.codeLocations, "frame:captured-target-binary-resume"),
  );
  const registers = translateNativeRegisterState(
    capturedRegisterInput(facts, FINAL_JUMP_TARGET_ENTRY),
  );
  const memory = translateNativeMemory(capturedMemoryInput(facts, TRANSLATED_STATE_MAPPING));
  const resources = translateNativeResources({ resources: sourceBundle.resources.resources });
  assertCapturedTranslationSteps({ codeMap, registers, stack, memory }, "target-binary final-jump");

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
    "target-binary-final-jump",
  );
  const resumeEvent = jumpIntoFinalTargetNativeCode({
    label: "target-binary-final-jump",
    trampoline,
    bundleDir,
    targetRegisters,
    textMarker: TEXT_MARKER,
    expectedInitialDataWord0: FINAL_JUMP_TARGET_DATA_START,
  });
  validateFinalJumpResumeEvent(resumeEvent, "native target-binary final jump");

  return {
    formatVersion: 1,
    phase: "target-binary-final-jump",
    hostArch: "amd64",
    sourceBundleDir,
    bundleDir,
    trampoline,
    targetBinary: continuation.binary,
    targetBuildId: continuation.buildId,
    targetSymbol: TARGET_SYMBOL,
    targetSymbolAddress: continuation.symbolAddress,
    targetSymbolSizeBytes: continuation.symbolSizeBytes,
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
    execution: "captured-arm64-source-jumped-matching-amd64-target-binary",
    resumeEvent,
    bundleTargetArch: translatedBundle.manifest.target.arch,
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function extractTargetBinaryContinuation(
  targetBinary: string,
  binDir: string,
): TargetBinaryContinuation {
  const symbols = readSymbols(targetBinary, [TARGET_SYMBOL]);
  const symbol = symbols.get(TARGET_SYMBOL);
  assert(symbol, `target binary symbol missing: ${TARGET_SYMBOL}`);
  assert(symbol.sizeBytes > 0, `target binary symbol ${TARGET_SYMBOL} has no size metadata`);
  const sectionPath = join(binDir, "machinen-target-binary-resume.bin");
  runCommand("objcopy", ["--dump-section", `${TARGET_SECTION}=${sectionPath}`, targetBinary], {
    label: "target-binary continuation section extract",
  });
  const sectionBytes = readFileSync(sectionPath);
  assert(sectionBytes.length > 0, `${TARGET_SECTION} was empty in target binary`);
  assert(
    symbol.sizeBytes <= sectionBytes.length,
    `${TARGET_SYMBOL} size exceeds extracted ${TARGET_SECTION} bytes`,
  );
  const bytes = sectionBytes.subarray(0, symbol.sizeBytes);
  assert(bytes[0] === 0x48 && bytes[1] === 0x89, `${TARGET_SYMBOL} did not start with amd64 code`);
  return {
    binary: targetBinary,
    buildId: sha256File(targetBinary),
    symbolAddress: symbol.address,
    symbolSizeBytes: symbol.sizeBytes,
    bytes,
  };
}

function codeMapInput(facts: CapturedArm64SourceFacts, continuation: TargetBinaryContinuation) {
  return {
    expectedTargetBuildId: continuation.buildId,
    targetBuildId: continuation.buildId,
    sourceSymbols: [
      {
        name: TARGET_SYMBOL,
        mapping: facts.textMapping.id,
        address: finalJumpHex(facts.sourcePc),
        sizeBytes: 64,
        metadata: "sidecar" as const,
      },
    ],
    targetSymbols: [
      {
        name: TARGET_SYMBOL,
        mapping: TARGET_TEXT_MAPPING,
        address: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
        sizeBytes: continuation.symbolSizeBytes,
        buildId: continuation.buildId,
        metadata: "symbol" as const,
      },
    ],
    requestedLocations: [
      {
        id: "code:captured-target-binary-resume",
        symbol: TARGET_SYMBOL,
        sourceAddress: finalJumpHex(facts.sourcePc),
      },
    ],
  };
}

function translatedMappings(
  facts: CapturedArm64SourceFacts,
  continuation: TargetBinaryContinuation,
) {
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
      reason: "source arm64 text is replaced by matching amd64 target-binary text",
    },
  };
}

function translatedTextMapping(continuation: TargetBinaryContinuation) {
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

function printSummary(summary: ReturnType<typeof verifyNativeTargetBinaryFinalJump>) {
  if ("skipped" in summary) {
    console.log(`native-target-binary-final-jump: skip — ${summary.reason}`);
    return;
  }
  console.log(
    `native-target-binary-final-jump: phase=${summary.phase} sourcePc=${summary.capturedSourcePc} sourcePtr=${summary.capturedSourcePointer}`,
  );
  console.log(`native-target-binary-final-jump: execution=${summary.execution}`);
}

main();
