#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { buildNativeCodeMap } from "../packages/runtime/src/native-code-map.ts";
import { translateNativeMemory } from "../packages/runtime/src/native-memory-translation.ts";
import {
  validateNativeProcessImageBundle,
  type NativeMemoryMapping,
  type NativeProcessImageDocuments,
  type NativeProcessResource,
} from "../packages/runtime/src/native-process-image.ts";
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import { translateNativeStack } from "../packages/runtime/src/native-stack-translation.ts";
import {
  NATIVE_FILE_RESOURCE_CONTINUATION_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  NATIVE_RESUME_TRAMPOLINE_SOURCE,
  bundleFileStats,
  compileNativeFileResourceContinuation,
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
  FINAL_JUMP_RESOURCE_CHECKSUM,
  FINAL_JUMP_RETURN_MARKER,
  FINAL_JUMP_TARGET_DATA_START,
  FINAL_JUMP_TARGET_ENTRY,
  FINAL_JUMP_TARGET_TEXT_START,
  finalJumpBundleMemoryFromTargetText,
  finalJumpHex,
  jumpIntoFinalTargetNativeCode,
  requireFinalJumpAmd64Registers,
  validateFinalJumpResourceResumeEvent,
  type FinalJumpRegularFileResource,
} from "./native-final-jump-utils.ts";
import {
  assertCapturedTranslationSteps,
  captureNativeArm64SourceBundle,
  capturedMemoryInput,
  capturedRegisterInput,
  capturedStackInput,
  inspectCapturedArm64Source,
  readCapturedU64,
  translatedCapturedManifest,
  translatedCapturedStackMapping,
  translatedCapturedStateMapping,
  translatedThreads,
  type CapturedArm64SourceFacts,
} from "./native-captured-source-utils.ts";

const USAGE =
  "usage: tsx scripts/native-file-resource-final-jump.ts [verify] [--out-dir path] [--json] [--keep]";
const SOURCE_BUNDLE_ENV = "MACHINEN_NATIVE_FILE_RESOURCE_SOURCE_BUNDLE";
const TEXT_MARKER = "machinen-native-file-resource-final-jump-v1";
const ACTIVE_SYMBOL = "machinen_native_file_resource_active";
const RETURN_SYMBOL = "machinen_native_file_resource_return";
const TARGET_SECTION = ".machinen_resume";
const TRANSLATED_STATE_MAPPING = "mapping:file-resource-state";
const TARGET_TEXT_MAPPING = "mapping:amd64-file-resource-text";
const RESOURCE_FILE_NAME = "native-file-resource.txt";
const RESOURCE_OFFSET = 9;
const RESOURCE_FD_WORD_OFFSET = 48n;
const RESOURCE_CHECKSUM_WORD_OFFSET = 56n;

interface FileResourceFacts extends CapturedArm64SourceFacts {
  sourceReturnAddress: bigint;
  sourceResourceFd: number;
  sourceResourceOffset: number;
  sourceResourcePath: string;
  sourceResourceChecksum: bigint;
  resource: NativeProcessResource;
}

interface FileResourceContinuation {
  binary: string;
  buildId: string;
  activeSymbolAddress: string;
  returnSymbolAddress: string;
  activeSymbolSizeBytes: number;
  returnSymbolSizeBytes: number;
  returnOffset: number;
  bytes: Buffer;
}

type NativeFileResourceFinalJumpSummary =
  | ReturnType<typeof captureArm64Source>
  | ReturnType<typeof translateAndJumpFileResource>
  | ReturnType<typeof sourceBundleOnArm64Skip>
  | ReturnType<typeof missingBundleSkip>
  | ReturnType<typeof unsupportedHostSkip>;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "native-file-resource-final-jump",
      "captured file-resource final jump uses Linux ptrace/procfs",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-native-file-resource-final-jump-");
  try {
    emitResult(verifyNativeFileResourceFinalJump(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeFileResourceFinalJump(outDir: string): NativeFileResourceFinalJumpSummary {
  const sourceBundle = process.env[SOURCE_BUNDLE_ENV];
  const handlers: Record<string, () => NativeFileResourceFinalJumpSummary> = {
    arm64: () => (sourceBundle ? sourceBundleOnArm64Skip() : captureArm64Source(outDir)),
    x64: () =>
      sourceBundle
        ? translateAndJumpFileResource(outDir, resolve(sourceBundle))
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
    reason: `${SOURCE_BUNDLE_ENV} must point at an arm64 source bundle for the amd64 file-resource final jump`,
  };
}

function unsupportedHostSkip() {
  return { skipped: true, reason: `unsupported host architecture: ${process.arch}` };
}

function captureArm64Source(outDir: string) {
  const { sourceBundleDir, capturer, target, sourceBundle, facts } = captureNativeArm64SourceBundle(
    {
      outDir,
      targetSource: NATIVE_FILE_RESOURCE_CONTINUATION_SOURCE,
      compileTarget: compileNativeFileResourceContinuation,
      resourceFileName: `source-bundle/${RESOURCE_FILE_NAME}`,
      label: "native file-resource source capture",
    },
  );
  const resource = inspectFileResource(sourceBundle, facts);
  return {
    formatVersion: 1,
    phase: "capture-source",
    hostArch: "arm64",
    sourceBundleDir,
    capturer,
    target,
    pid: sourceBundle.manifest.capture.pid,
    threadId: resource.thread.id,
    capturedSourcePc: finalJumpHex(resource.sourcePc),
    capturedSourcePointer: finalJumpHex(resource.sourcePointer),
    capturedSourceReturnAddress: finalJumpHex(resource.sourceReturnAddress),
    regularFileFd: resource.sourceResourceFd,
    sourceResourcePath: resource.sourceResourcePath,
    sourceResourceOffset: resource.sourceResourceOffset,
    resourceChecksum: finalJumpHex(resource.sourceResourceChecksum),
    execution: "captured-arm64-source-awaiting-amd64-file-resource-final-jump",
    bundleFiles: bundleFileStats(sourceBundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function translateAndJumpFileResource(outDir: string, sourceBundleDir: string) {
  ensureSourcesExist([NATIVE_RESUME_TRAMPOLINE_SOURCE, NATIVE_FILE_RESOURCE_CONTINUATION_SOURCE]);
  const sourceBundle = validateNativeProcessImageBundle(sourceBundleDir);
  const resource = inspectFileResource(sourceBundle, inspectCapturedArm64Source(sourceBundle));
  const binDir = join(outDir, "bin");
  const bundleDir = join(outDir, "bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });

  const trampoline = compileNativeResumeTrampoline(binDir);
  const targetBinary = compileNativeFileResourceContinuation(binDir);
  const continuation = extractFileResourceContinuation(targetBinary, binDir);
  const translatedReturnAddress = FINAL_JUMP_TARGET_ENTRY + BigInt(continuation.returnOffset);
  const codeMap = buildNativeCodeMap(codeMapInput(resource, continuation, translatedReturnAddress));
  const stack = translateNativeStack(
    capturedStackInput(
      resource,
      codeMap.codeLocations,
      "frame:captured-file-resource-active",
      resource.sourceReturnAddress,
    ),
  );
  const registers = translateNativeRegisterState(
    capturedRegisterInput(resource, FINAL_JUMP_TARGET_ENTRY),
  );
  const memory = translateNativeMemory(capturedMemoryInput(resource, TRANSLATED_STATE_MAPPING));
  const targetResources = relocatedFileResourceInputs(sourceBundleDir, sourceBundle, resource);
  const resources = translateNativeResources({ resources: targetResources });
  assertCapturedTranslationSteps({ codeMap, registers, stack, memory }, "file-resource final-jump");
  const reopenResource = regularFileResumeResource(resources.resources, resource.resource.id);

  writeNativeProcessImageBundle(
    bundleDir,
    nativeProofBundleDocuments(
      fileResourceBundleMemory(TEXT_MARKER, continuation.bytes, resource.sourceResourceFd),
      translatedCapturedManifest(sourceBundle),
      translatedMappings(resource, continuation),
      translatedThreads(resource),
      resources.resources,
      { codeMap, registers, stack, memory, resources },
      { vocabularyVersion: 1, refusals: resources.refusals },
    ),
  );
  const translatedBundle = validateNativeProcessImageBundle(bundleDir);
  const targetRegisters = requireFinalJumpAmd64Registers(
    registers.threads[0],
    "file-resource-final-jump",
  );
  const resumeEvent = jumpIntoFinalTargetNativeCode({
    label: "file-resource-final-jump",
    trampoline,
    bundleDir,
    targetRegisters,
    textMarker: TEXT_MARKER,
    expectedInitialDataWord0: FINAL_JUMP_TARGET_DATA_START,
    translatedReturnAddress,
    expectedReturnMarker: FINAL_JUMP_RETURN_MARKER,
    expectedResourceChecksum: FINAL_JUMP_RESOURCE_CHECKSUM,
    regularFileResources: [reopenResource],
  });
  validateFinalJumpResourceResumeEvent(
    resumeEvent,
    "native file-resource final jump",
    translatedReturnAddress,
  );

  return {
    formatVersion: 1,
    phase: "file-resource-final-jump",
    hostArch: "amd64",
    sourceBundleDir,
    bundleDir,
    trampoline,
    targetBinary: continuation.binary,
    targetBuildId: continuation.buildId,
    activeSymbol: ACTIVE_SYMBOL,
    returnSymbol: RETURN_SYMBOL,
    sourcePid: sourceBundle.manifest.capture.pid,
    threadId: resource.thread.id,
    capturedSourcePc: finalJumpHex(resource.sourcePc),
    capturedSourcePointer: finalJumpHex(resource.sourcePointer),
    capturedSourceReturnAddress: finalJumpHex(resource.sourceReturnAddress),
    translatedEntry: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    translatedReturnAddress: finalJumpHex(translatedReturnAddress),
    regularFileFd: resource.sourceResourceFd,
    sourceResourcePath: resource.sourceResourcePath,
    translatedResourcePath: reopenResource.path,
    sourceResourceOffset: resource.sourceResourceOffset,
    resourceChecksum: finalJumpHex(resource.sourceResourceChecksum),
    codeLocations: codeMap.codeLocations.length,
    stackRelocations: stack.relocations.length,
    memoryRelocations: memory.relocations.length,
    resourceRecipes: resources.resources.filter((candidate) => candidate.state === "recipe").length,
    resourceRefusals: resources.refusals.length,
    execution: "captured-arm64-file-resource-reopened-after-native-amd64-ret",
    resumeEvent,
    bundleTargetArch: translatedBundle.manifest.target.arch,
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function inspectFileResource(
  bundle: NativeProcessImageDocuments,
  facts: CapturedArm64SourceFacts,
): FileResourceFacts {
  const sourceReturnAddress = capturedArm64ReturnAddress(facts);
  const sourceResourceFd = Number(
    readCapturedU64(bundle, facts.dataMapping, facts.sourcePointer + RESOURCE_FD_WORD_OFFSET),
  );
  const sourceResourceChecksum = readCapturedU64(
    bundle,
    facts.dataMapping,
    facts.sourcePointer + RESOURCE_CHECKSUM_WORD_OFFSET,
  );
  assert(sourceResourceFd > 2, "captured regular-file fd must not replace stdio");
  assert(
    sourceResourceChecksum === FINAL_JUMP_RESOURCE_CHECKSUM,
    "captured file resource checksum mismatched",
  );
  const resource = capturedRegularFileResource(bundle, sourceResourceFd);
  assert(resource.path, "captured regular-file resource did not include a path");
  assert(
    resource.offset === RESOURCE_OFFSET,
    `captured regular-file fd offset was ${resource.offset}, expected ${RESOURCE_OFFSET}`,
  );
  return {
    ...facts,
    sourceReturnAddress,
    sourceResourceFd,
    sourceResourceOffset: resource.offset,
    sourceResourcePath: resource.path,
    sourceResourceChecksum,
    resource,
  };
}

function capturedArm64ReturnAddress(facts: CapturedArm64SourceFacts) {
  const sourceReturnAddress = BigInt(facts.thread.sourceRegisters.x[30] ?? "0x0");
  assert(sourceReturnAddress !== 0n, "captured arm64 x30 did not hold a return address");
  assert(sourceReturnAddress !== facts.sourcePc, "captured arm64 return address matched PC");
  return sourceReturnAddress;
}

function capturedRegularFileResource(bundle: NativeProcessImageDocuments, fd: number) {
  const resource = bundle.resources.resources.find(
    (candidate) =>
      candidate.kind === "file" &&
      candidate.fd === fd &&
      candidate.path !== undefined &&
      basename(candidate.path) === RESOURCE_FILE_NAME,
  );
  assert(resource, `captured regular-file fd ${fd} was missing from native resources`);
  return resource;
}

function relocatedFileResourceInputs(
  sourceBundleDir: string,
  sourceBundle: NativeProcessImageDocuments,
  facts: FileResourceFacts,
) {
  const targetResourcePath = join(sourceBundleDir, RESOURCE_FILE_NAME);
  assert(
    existsSync(targetResourcePath),
    `source bundle did not carry regular-file payload ${RESOURCE_FILE_NAME}`,
  );
  return sourceBundle.resources.resources.map((resource) =>
    resource.id === facts.resource.id
      ? { ...resource, path: targetResourcePath, state: "captured" as const }
      : resource,
  );
}

// fallow-ignore-next-line complexity
function regularFileResumeResource(
  resources: NativeProcessResource[],
  id: string,
): FinalJumpRegularFileResource {
  const resource = resources.find((candidate) => candidate.id === id);
  assert(resource, `translated regular-file resource ${id} is missing`);
  assert(resource.state === "recipe", `translated regular-file resource ${id} has no recipe`);
  assert(resource.fd !== undefined, `translated regular-file resource ${id} has no fd`);
  const recipe = resource.recipe;
  const reopen = recipe?.reopen;
  const offset = recipe?.offset;
  if (typeof reopen !== "string") {
    throw new Error(`resource ${id} has no reopen path`);
  }
  if (typeof offset !== "number") {
    throw new Error(`resource ${id} has no reopen offset`);
  }
  return { fd: resource.fd, path: reopen, offset };
}

function extractFileResourceContinuation(
  targetBinary: string,
  binDir: string,
): FileResourceContinuation {
  const symbols = readSymbols(targetBinary, [ACTIVE_SYMBOL, RETURN_SYMBOL]);
  const active = symbols.get(ACTIVE_SYMBOL);
  const landing = symbols.get(RETURN_SYMBOL);
  assert(active, `target binary symbol missing: ${ACTIVE_SYMBOL}`);
  assert(landing, `target binary symbol missing: ${RETURN_SYMBOL}`);
  const activeAddress = BigInt(active.address);
  const landingAddress = BigInt(landing.address);
  assert(landingAddress > activeAddress, `${RETURN_SYMBOL} must follow ${ACTIVE_SYMBOL}`);
  const returnOffset = Number(landingAddress - activeAddress);
  const sectionPath = join(binDir, "machinen-file-resource-resume.bin");
  runCommand("objcopy", ["--dump-section", `${TARGET_SECTION}=${sectionPath}`, targetBinary], {
    label: "file-resource continuation section extract",
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
  facts: FileResourceFacts,
  continuation: FileResourceContinuation,
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
        address: finalJumpHex(facts.sourceReturnAddress),
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
        id: "code:captured-file-resource-active",
        symbol: ACTIVE_SYMBOL,
        sourceAddress: finalJumpHex(facts.sourcePc),
      },
      {
        id: "code:captured-file-resource-return",
        symbol: RETURN_SYMBOL,
        sourceAddress: finalJumpHex(facts.sourceReturnAddress),
      },
    ],
  };
}

function translatedMappings(facts: FileResourceFacts, continuation: FileResourceContinuation) {
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
      reason: "source arm64 text is replaced by matching amd64 file-resource target text",
    },
  };
}

function translatedTextMapping(continuation: FileResourceContinuation) {
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

function fileResourceBundleMemory(textMarker: string, targetText: Buffer, resourceFd: number) {
  const memory = finalJumpBundleMemoryFromTargetText(
    textMarker,
    targetText,
    FINAL_JUMP_TARGET_DATA_START,
  );
  memory.writeBigUInt64LE(
    BigInt(resourceFd),
    FINAL_JUMP_PAGE_SIZE + Number(RESOURCE_FD_WORD_OFFSET),
  );
  memory.writeBigUInt64LE(
    FINAL_JUMP_RESOURCE_CHECKSUM,
    FINAL_JUMP_PAGE_SIZE + Number(RESOURCE_CHECKSUM_WORD_OFFSET),
  );
  return memory;
}

function printSummary(summary: ReturnType<typeof verifyNativeFileResourceFinalJump>) {
  if ("skipped" in summary) {
    console.log(`native-file-resource-final-jump: skip — ${summary.reason}`);
    return;
  }
  console.log(
    `native-file-resource-final-jump: phase=${summary.phase} sourceRoot=${summary.capturedSourcePointer} fd=${summary.regularFileFd}`,
  );
  console.log(`native-file-resource-final-jump: execution=${summary.execution}`);
}

main();
