#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildNativeCodeMap } from "../packages/runtime/src/native-code-map.ts";
import { translateNativeMemory } from "../packages/runtime/src/native-memory-translation.ts";
import {
  validateNativeProcessImageBundle,
  type NativeArm64Registers,
  type NativeProcessImageDocuments,
} from "../packages/runtime/src/native-process-image.ts";
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import {
  translateNativeStack,
  type NativeStackFrame,
} from "../packages/runtime/src/native-stack-translation.ts";
import {
  discoverNativeUnwindFrames,
  nativeUnwindReturnAddressSlot,
  parseNativeEhFrameText,
  type NativeDiscoveredUnwindFrame,
  type NativeUnwindFrameRule,
} from "../packages/runtime/src/native-unwind-frames.ts";
import {
  NATIVE_DWARF_UNWIND_CONTINUATION_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  NATIVE_RESUME_TRAMPOLINE_SOURCE,
  bundleFileStats,
  compileNativeDwarfUnwindContinuation,
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
  FINAL_JUMP_STACK_SIZE,
  FINAL_JUMP_TARGET_DATA_START,
  FINAL_JUMP_TARGET_ENTRY,
  FINAL_JUMP_TARGET_STACK_START,
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
  inspectCapturedArm64Source,
  readCapturedU64,
  translatedCapturedManifest,
  translatedCapturedStackMapping,
  translatedCapturedStateMapping,
  translatedOmittedSourceTextMapping,
  translatedStackReturnAddress,
  translatedTargetTextMapping,
  translatedThreads,
  type CapturedArm64SourceFacts,
} from "./native-captured-source-utils.ts";

const USAGE =
  "usage: tsx scripts/native-dwarf-unwind-frames.ts [verify] [--out-dir path] [--json] [--keep]";
const SOURCE_BUNDLE_ENV = "MACHINEN_NATIVE_DWARF_UNWIND_SOURCE_BUNDLE";
const UNWIND_METADATA_FILE = "native-unwind-frames.json";
const TEXT_MARKER = "machinen-native-dwarf-unwind-frames-v1";
const ACTIVE_SYMBOL = "machinen_native_dwarf_unwind_active";
const RETURN_SYMBOL = "machinen_native_dwarf_unwind_return";
const TARGET_SECTION = ".machinen_resume";
const TRANSLATED_STATE_MAPPING = "mapping:dwarf-unwind-state";
const TARGET_TEXT_MAPPING = "mapping:amd64-dwarf-unwind-text";

interface DwarfUnwindMetadata {
  formatVersion: 1;
  rule: NativeUnwindFrameRule;
  discoveredFrame: NativeDiscoveredUnwindFrame;
}

interface DwarfUnwindContinuation {
  binary: string;
  buildId: string;
  activeSymbolAddress: string;
  returnSymbolAddress: string;
  activeSymbolSizeBytes: number;
  returnSymbolSizeBytes: number;
  returnOffset: number;
  bytes: Buffer;
}

type NativeDwarfUnwindFramesSummary =
  | ReturnType<typeof captureArm64Source>
  | ReturnType<typeof translateAndJumpDwarfFrame>
  | ReturnType<typeof sourceBundleOnArm64Skip>
  | ReturnType<typeof missingBundleSkip>
  | ReturnType<typeof unsupportedHostSkip>;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(args, "native-dwarf-unwind-frames", "DWARF unwind capture uses Linux ptrace/procfs");
    return;
  }

  const workspace = createWorkspace(args, "machinen-native-dwarf-unwind-frames-");
  try {
    emitResult(verifyNativeDwarfUnwindFrames(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

// fallow-ignore-next-line complexity
function verifyNativeDwarfUnwindFrames(outDir: string): NativeDwarfUnwindFramesSummary {
  const sourceBundle = process.env[SOURCE_BUNDLE_ENV];
  if (process.arch === "arm64") {
    return sourceBundle ? sourceBundleOnArm64Skip() : captureArm64Source(outDir);
  }
  if (process.arch === "x64") {
    return sourceBundle
      ? translateAndJumpDwarfFrame(outDir, resolve(sourceBundle))
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
    reason: `${SOURCE_BUNDLE_ENV} must point at an arm64 source bundle with ${UNWIND_METADATA_FILE}`,
  };
}

function unsupportedHostSkip() {
  return { skipped: true, reason: `unsupported host architecture: ${process.arch}` };
}

function captureArm64Source(outDir: string) {
  const { sourceBundleDir, capturer, target, sourceBundle, facts } = captureNativeArm64SourceBundle(
    {
      outDir,
      targetSource: NATIVE_DWARF_UNWIND_CONTINUATION_SOURCE,
      compileTarget: compileNativeDwarfUnwindContinuation,
      resourceFileName: "native-dwarf-unwind-resource.txt",
      label: "native DWARF unwind source capture",
    },
  );
  const metadata = discoverSourceFrameFromDwarf(target, sourceBundle, facts);
  writeFileSync(
    join(sourceBundleDir, UNWIND_METADATA_FILE),
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
    threadId: facts.thread.id,
    capturedSourcePc: finalJumpHex(facts.sourcePc),
    capturedSourcePointer: finalJumpHex(facts.sourcePointer),
    discoveredReturnAddress: metadata.discoveredFrame.returnAddress,
    discoveredReturnAddressSlot: metadata.discoveredFrame.returnAddressSlot,
    cfa: metadata.discoveredFrame.cfa,
    unwindRule: metadata.rule,
    textMapping: facts.textMapping.id,
    stackMapping: facts.stackMapping.id,
    execution: "captured-arm64-source-frame-discovered-from-dwarf-unwind-metadata",
    bundleFiles: bundleFileStats(sourceBundleDir, [
      ...NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
      UNWIND_METADATA_FILE,
    ]),
  };
}

function translateAndJumpDwarfFrame(outDir: string, sourceBundleDir: string) {
  ensureSourcesExist([NATIVE_RESUME_TRAMPOLINE_SOURCE, NATIVE_DWARF_UNWIND_CONTINUATION_SOURCE]);
  const sourceBundle = validateNativeProcessImageBundle(sourceBundleDir);
  const facts = inspectCapturedArm64Source(sourceBundle);
  const metadata = readUnwindMetadata(sourceBundleDir);
  const { binDir, bundleDir } = createProofBinAndBundleDirs(outDir);

  const trampoline = compileNativeResumeTrampoline(binDir);
  const targetBinary = compileNativeDwarfUnwindContinuation(binDir);
  const continuation = extractDwarfUnwindContinuation(targetBinary, binDir);
  const translatedReturnAddress = FINAL_JUMP_TARGET_ENTRY + BigInt(continuation.returnOffset);
  const codeMap = buildNativeCodeMap(
    codeMapInput(facts, metadata.discoveredFrame, continuation, translatedReturnAddress),
  );
  const stack = translateNativeStack(
    stackInput(facts.stackMapping.id, metadata.discoveredFrame.stackFrame, codeMap.codeLocations),
  );
  const { registers, memory, resources } = translateDwarfResumeState(sourceBundle, facts);
  assertCapturedTranslationSteps({ codeMap, registers, stack, memory }, "DWARF unwind final-jump");
  assert(
    translatedStackReturnAddress(stack) === translatedReturnAddress,
    "DWARF-discovered return address did not translate to the target landing",
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
      translatedMappingsDocument(facts, continuation),
      translatedThreads(facts),
      resources.resources,
      { codeMap, registers, stack, memory, resources },
      { vocabularyVersion: 1, refusals: resources.refusals },
    ),
  );
  const targetRegisters = requireFinalJumpAmd64Registers(
    registers.threads[0],
    "dwarf-unwind-final-jump",
  );
  const resumeEvent = jumpIntoFinalTargetNativeCode({
    label: "dwarf-unwind-final-jump",
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
    "native DWARF unwind final jump",
    translatedReturnAddress,
  );

  return {
    formatVersion: 1,
    phase: "dwarf-unwind-final-jump",
    hostArch: "amd64",
    sourceBundleDir,
    bundleDir,
    targetBuildId: continuation.buildId,
    activeSymbol: ACTIVE_SYMBOL,
    returnSymbol: RETURN_SYMBOL,
    capturedSourcePc: finalJumpHex(facts.sourcePc),
    discoveredReturnAddress: metadata.discoveredFrame.returnAddress,
    discoveredReturnAddressSlot: metadata.discoveredFrame.returnAddressSlot,
    cfa: metadata.discoveredFrame.cfa,
    translatedEntry: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    translatedReturnAddress: finalJumpHex(translatedReturnAddress),
    codeLocations: codeMap.codeLocations.length,
    stackRelocations: stack.relocations.length,
    execution: "captured-arm64-source-returned-through-dwarf-discovered-amd64-frame",
    resumeEvent,
  };
}

function translateDwarfResumeState(
  sourceBundle: NativeProcessImageDocuments,
  facts: CapturedArm64SourceFacts,
) {
  const registerPlan = capturedRegisterInput(facts, FINAL_JUMP_TARGET_ENTRY);
  const memoryPlan = capturedMemoryInput(facts, TRANSLATED_STATE_MAPPING);
  return {
    registers: translateNativeRegisterState(registerPlan),
    memory: translateNativeMemory(memoryPlan),
    resources: translateNativeResources({ resources: sourceBundle.resources.resources }),
  };
}

function discoverSourceFrameFromDwarf(
  target: string,
  bundle: NativeProcessImageDocuments,
  facts: CapturedArm64SourceFacts,
): DwarfUnwindMetadata {
  const rule = dwarfRuleForActiveFunction(target, facts);
  const sourceRegisters = facts.thread.sourceRegisters as NativeArm64Registers;
  const returnAddressSlot = nativeUnwindReturnAddressSlot({ rule, sourceRegisters });
  assert(returnAddressSlot, "DWARF rule did not describe a stack return-address slot");
  const returnAddress = readCapturedU64(bundle, facts.stackMapping, BigInt(returnAddressSlot));
  const discovered = discoverNativeUnwindFrames({
    threadId: facts.thread.id,
    stackMapping: facts.stackMapping.id,
    sourceRegisters,
    rules: [rule],
    stackWords: [{ address: returnAddressSlot, value: finalJumpHex(returnAddress) }],
  });
  assert(discovered.refusals.length === 0, "DWARF unwind frame discovery refused unexpectedly");
  const discoveredFrame = discovered.frames[0];
  assert(discoveredFrame, "DWARF unwind frame discovery produced no frame");
  assert(
    BigInt(discoveredFrame.returnAddress) !== facts.sourcePc,
    "DWARF return address matched active PC",
  );
  return { formatVersion: 1, rule, discoveredFrame };
}

function dwarfRuleForActiveFunction(
  target: string,
  facts: CapturedArm64SourceFacts,
): NativeUnwindFrameRule {
  const symbols = readSymbols(target, [ACTIVE_SYMBOL]);
  const active = symbols.get(ACTIVE_SYMBOL);
  assert(active, `missing source symbol: ${ACTIVE_SYMBOL}`);
  assert(active.sizeBytes > 0, `${ACTIVE_SYMBOL} has no size metadata`);
  const sourcePc = facts.sourcePc;
  const symbolStart = BigInt(active.address);
  const symbolEnd = symbolStart + BigInt(active.sizeBytes);
  assert(sourcePc >= symbolStart && sourcePc < symbolEnd, "captured PC is outside active symbol");
  const parsed = parseNativeEhFrameText({
    readelfFrames: runCommand("readelf", ["--debug-dump=frames", target], {
      label: "DWARF CFI scan",
    }).stdout,
    mapping: facts.textMapping.id,
    functionName: ACTIVE_SYMBOL,
    pc: finalJumpHex(symbolStart),
  });
  assert(parsed.refusals.length === 0, `FDE refused: ${JSON.stringify(parsed.refusals)}`);
  const rule = parsed.rules[0];
  assert(rule, `readelf did not report an FDE for ${ACTIVE_SYMBOL}`);
  return {
    ...rule,
    id: `fde:${ACTIVE_SYMBOL}`,
    pcStart: active.address,
    pcEnd: finalJumpHex(symbolEnd),
  };
}

function readUnwindMetadata(sourceBundleDir: string): DwarfUnwindMetadata {
  return JSON.parse(readFileSync(join(sourceBundleDir, UNWIND_METADATA_FILE), "utf8"));
}

function extractDwarfUnwindContinuation(
  targetBinary: string,
  binDir: string,
): DwarfUnwindContinuation {
  const symbols = readSymbols(targetBinary, [ACTIVE_SYMBOL, RETURN_SYMBOL]);
  const active = symbols.get(ACTIVE_SYMBOL);
  const landing = symbols.get(RETURN_SYMBOL);
  assert(active?.sizeBytes, `target symbol ${ACTIVE_SYMBOL} is missing size metadata`);
  assert(landing?.sizeBytes, `target symbol ${RETURN_SYMBOL} is missing size metadata`);
  const returnOffset = Number(BigInt(landing.address) - BigInt(active.address));
  assert(returnOffset > 0, `${RETURN_SYMBOL} must follow ${ACTIVE_SYMBOL}`);
  const sectionPath = join(binDir, "machinen-dwarf-unwind-resume.bin");
  runCommand("objcopy", ["--dump-section", `${TARGET_SECTION}=${sectionPath}`, targetBinary], {
    label: "DWARF unwind continuation section extract",
  });
  const sectionBytes = readFileSync(sectionPath);
  const bytes = sectionBytes.subarray(0, returnOffset + landing.sizeBytes);
  assert(
    bytes.length >= returnOffset + landing.sizeBytes,
    `${TARGET_SECTION} did not include both symbols`,
  );
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
  facts: CapturedArm64SourceFacts,
  discoveredFrame: NativeDiscoveredUnwindFrame,
  continuation: DwarfUnwindContinuation,
  translatedReturnAddress: bigint,
) {
  return {
    expectedTargetBuildId: continuation.buildId,
    targetBuildId: continuation.buildId,
    sourceSymbols: [
      sourceSymbol(ACTIVE_SYMBOL, facts.textMapping.id, finalJumpHex(facts.sourcePc)),
      sourceSymbol(RETURN_SYMBOL, facts.textMapping.id, discoveredFrame.returnAddress),
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
        id: "code:dwarf-active",
        symbol: ACTIVE_SYMBOL,
        sourceAddress: finalJumpHex(facts.sourcePc),
      },
      {
        id: "code:dwarf-return",
        symbol: RETURN_SYMBOL,
        sourceAddress: discoveredFrame.returnAddress,
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

function stackInput(
  stackMapping: string,
  frame: NativeStackFrame,
  codeLocations: ReturnType<typeof buildNativeCodeMap>["codeLocations"],
) {
  return {
    stackMapping,
    targetStackBase: finalJumpHex(FINAL_JUMP_TARGET_STACK_START + BigInt(FINAL_JUMP_STACK_SIZE)),
    frames: [frame],
    codeLocations,
  };
}

function translatedMappingsDocument(
  facts: CapturedArm64SourceFacts,
  continuation: DwarfUnwindContinuation,
) {
  return {
    formatVersion: 1,
    mappings: [
      translatedOmittedSourceTextMapping(
        facts.textMapping,
        "source text is replaced by amd64 DWARF target text",
      ),
      translatedTargetTextMapping({
        id: TARGET_TEXT_MAPPING,
        binary: continuation.binary,
        buildId: continuation.buildId,
        targetStart: FINAL_JUMP_TARGET_TEXT_START,
        sizeBytes: FINAL_JUMP_PAGE_SIZE,
      }),
      translatedCapturedStateMapping(facts, TRANSLATED_STATE_MAPPING),
      translatedCapturedStackMapping(facts.stackMapping),
    ],
    refusals: nativeEmptyRefusals(),
  };
}

function printSummary(summary: NativeDwarfUnwindFramesSummary) {
  if ("skipped" in summary) {
    console.log(`native-dwarf-unwind-frames: skip — ${summary.reason}`);
    return;
  }
  console.log(
    `native-dwarf-unwind-frames: phase=${summary.phase} pc=${summary.capturedSourcePc} return=${summary.discoveredReturnAddress}`,
  );
  console.log(`native-dwarf-unwind-frames: execution=${summary.execution}`);
}

main();
