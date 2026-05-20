import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateNativeProcessImageBundle,
  type NativeArm64Registers,
  type NativeCodeLocationMapping,
  type NativeMemoryMapping,
  type NativeProcessImageDocuments,
  type NativeThreadState,
} from "../packages/runtime/src/native-process-image.ts";
import { translateNativeMemory } from "../packages/runtime/src/native-memory-translation.ts";
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import { translateNativeStack } from "../packages/runtime/src/native-stack-translation.ts";
import {
  NATIVE_CAPTURE_SOURCE,
  compileNativeProcessCapturer,
  ensureSourcesExist,
  nativeEmptyRefusals,
} from "./controlled-corpus-utils.mjs";
import { assert, runCommand } from "./proof-script-utils.mjs";
import {
  FINAL_JUMP_PAGE_SIZE,
  FINAL_JUMP_STACK_SIZE,
  FINAL_JUMP_TARGET_DATA_START,
  FINAL_JUMP_TARGET_STACK_POINTER,
  FINAL_JUMP_TARGET_STACK_START,
  finalJumpHex,
} from "./native-final-jump-utils.ts";

export const CAPTURED_SOURCE_STATE_MARKER = 0x534f555243454a50n;
export const CAPTURE_SETTLE_MS = "200";

export interface CapturedArm64SourceFacts {
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

export interface NativeArm64SourceCaptureArtifacts {
  sourceBundleDir: string;
  capturer: string;
  target: string;
  sourceBundle: NativeProcessImageDocuments;
  facts: CapturedArm64SourceFacts;
}

export function captureNativeArm64SourceBundle(options: {
  outDir: string;
  targetSource: string;
  compileTarget: (binDir: string) => string;
  resourceFileName: string;
  label: string;
}): NativeArm64SourceCaptureArtifacts {
  ensureSourcesExist([NATIVE_CAPTURE_SOURCE, options.targetSource]);
  const binDir = join(options.outDir, "bin");
  const sourceBundleDir = join(options.outDir, "source-bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(sourceBundleDir, { recursive: true });

  const capturer = compileNativeProcessCapturer(binDir);
  const target = options.compileTarget(binDir);
  const resourceFile = join(options.outDir, options.resourceFileName);
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
    { label: options.label },
  );

  const sourceBundle = validateNativeProcessImageBundle(sourceBundleDir);
  return {
    sourceBundleDir,
    capturer,
    target,
    sourceBundle,
    facts: inspectCapturedArm64Source(sourceBundle),
  };
}

export function inspectCapturedArm64Source(
  bundle: NativeProcessImageDocuments,
): CapturedArm64SourceFacts {
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
  assert(
    sourceMarker === CAPTURED_SOURCE_STATE_MARKER,
    "captured source state marker did not match",
  );

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

export function capturedStackInput(
  facts: CapturedArm64SourceFacts,
  codeLocations: NativeCodeLocationMapping[],
  frameId: string,
) {
  return {
    stackMapping: facts.stackMapping.id,
    targetStackBase: finalJumpHex(FINAL_JUMP_TARGET_STACK_START + BigInt(FINAL_JUMP_STACK_SIZE)),
    codeLocations,
    frames: [
      {
        id: frameId,
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

export function capturedRegisterInput(facts: CapturedArm64SourceFacts, targetEntry: bigint) {
  return {
    sourceArch: "arm64" as const,
    targetArch: "amd64" as const,
    threads: [facts.thread],
    continuations: {
      [facts.thread.id]: {
        sourcePc: finalJumpHex(facts.sourcePc),
        targetIp: finalJumpHex(targetEntry),
        targetSp: finalJumpHex(FINAL_JUMP_TARGET_STACK_POINTER),
        targetTls: "0x0",
        targetRegisterOverrides: { rdi: finalJumpHex(FINAL_JUMP_TARGET_DATA_START) },
      },
    },
  };
}

export function capturedMemoryInput(facts: CapturedArm64SourceFacts, mapping: string) {
  return {
    words: [
      {
        mapping,
        offset: 0,
        sourceValue: finalJumpHex(facts.sourceInitialWord0),
        targetValue: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
        classification: "pointer" as const,
        proof: "sidecar" as const,
      },
    ],
  };
}

export function translatedCapturedManifest(sourceBundle: NativeProcessImageDocuments) {
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

export function translatedCapturedStateMapping(facts: CapturedArm64SourceFacts, mappingId: string) {
  return {
    id: mappingId,
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

export function translatedCapturedStackMapping(mapping: NativeMemoryMapping) {
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

export function translatedThreads(facts: CapturedArm64SourceFacts) {
  return { formatVersion: 1, threads: [facts.thread], refusals: nativeEmptyRefusals() };
}

export function assertCapturedTranslationSteps(
  steps: {
    codeMap: { refusals: unknown[] };
    registers: ReturnType<typeof translateNativeRegisterState>;
    stack: ReturnType<typeof translateNativeStack>;
    memory: ReturnType<typeof translateNativeMemory>;
  },
  label: string,
) {
  assert(steps.codeMap.refusals.length === 0, `${label} code map refused unexpectedly`);
  assert(steps.registers.refusals.length === 0, `${label} registers refused unexpectedly`);
  assert(steps.stack.refusals.length === 0, `${label} stack refused unexpectedly`);
  assert(steps.memory.refusals.length === 0, `${label} memory refused unexpectedly`);
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
