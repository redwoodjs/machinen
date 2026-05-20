#!/usr/bin/env tsx
import { buildNativeCodeMap } from "../packages/runtime/src/native-code-map.ts";
import { translateNativeMemory } from "../packages/runtime/src/native-memory-translation.ts";
import { validateNativeProcessImageBundle } from "../packages/runtime/src/native-process-image.ts";
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import { translateNativeStack } from "../packages/runtime/src/native-stack-translation.ts";
import {
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  NATIVE_RESUME_TRAMPOLINE_SOURCE,
  assertNativeProofStepsTranslated,
  bundleFileStats,
  compileNativeResumeTrampoline,
  createProofBinAndBundleDirs,
  ensureSourcesExist,
  nativeEmptyRefusals,
  nativeProofBundleDocuments,
  writeNativeProcessImageBundle,
} from "./controlled-corpus-utils.mjs";
import {
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  emitSkip,
  parseVerifyArgs,
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

const USAGE = "usage: tsx scripts/native-final-jump.ts [verify] [--out-dir path] [--json] [--keep]";
const TEXT_MARKER = "machinen-native-final-jump-v1";
const SOURCE_TEXT_START = 0x400000n;
const SOURCE_RESUME_PC = 0x400120n;
const SOURCE_DATA_START = 0x600000n;
const SOURCE_STACK_START = 0x700000000000n;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux" || process.arch !== "x64") {
    emitSkip(args, "native-final-jump", "target-native amd64 final jump requires Linux/amd64");
    return;
  }
  const workspace = createWorkspace(args, "machinen-native-final-jump-");
  try {
    emitResult(verifyNativeFinalJump(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

// fallow-ignore-next-line complexity
function verifyNativeFinalJump(outDir: string) {
  ensureSourcesExist([NATIVE_RESUME_TRAMPOLINE_SOURCE]);
  const { binDir, bundleDir } = createProofBinAndBundleDirs(outDir);
  const trampoline = compileNativeResumeTrampoline(binDir);

  const codeMap = buildNativeCodeMap(codeMapInput());
  const stack = translateNativeStack(stackInput(codeMap.codeLocations));
  const registers = translateNativeRegisterState(registerInput());
  const resources = translateNativeResources(resourceInput());
  const memory = translateNativeMemory(memoryInput());
  const steps = { codeMap, registers, stack, memory, resources };
  assertNativeProofStepsTranslated(steps, "final-jump");

  writeNativeProcessImageBundle(
    bundleDir,
    nativeProofBundleDocuments(
      finalJumpBundleMemory(TEXT_MARKER),
      manifest(),
      mappings(),
      threads(),
      resources.resources,
      steps,
    ),
  );
  const bundle = validateNativeProcessImageBundle(bundleDir);
  const targetRegisters = requireFinalJumpAmd64Registers(registers.threads[0], "final-jump");
  const resumeEvent = jumpIntoFinalTargetNativeCode({
    label: "final-jump",
    trampoline,
    bundleDir,
    targetRegisters,
    textMarker: TEXT_MARKER,
  });
  validateFinalJumpResumeEvent(resumeEvent, "native final jump");

  return {
    formatVersion: 1,
    hostArch: "amd64",
    bundleDir,
    trampoline,
    codeLocations: codeMap.codeLocations.length,
    registerThreads: registers.threads.length,
    stackRelocations: stack.relocations.length,
    memoryRelocations: memory.relocations.length,
    resourceRecipes: resources.resources.filter((resource) => resource.state === "recipe").length,
    translatedEntry: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    translatedArgument: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
    execution: "jumped-target-native-amd64-code",
    resumeEvent,
    bundleTargetArch: bundle.manifest.target.arch,
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function codeMapInput() {
  return {
    expectedTargetBuildId: "46446464",
    targetBuildId: "46446464",
    sourceSymbols: [
      {
        name: "native_final_jump_resume",
        mapping: "mapping:arm64-text",
        address: finalJumpHex(SOURCE_RESUME_PC),
        sizeBytes: 64,
        metadata: "sidecar" as const,
      },
    ],
    targetSymbols: [
      {
        name: "native_final_jump_resume",
        mapping: "mapping:amd64-text",
        address: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
        sizeBytes: 64,
        metadata: "sidecar" as const,
      },
    ],
    requestedLocations: [{ id: "code:resume", symbol: "native_final_jump_resume" }],
  };
}

function registerInput() {
  const x = Array.from({ length: 31 }, () => "0x0");
  x[0] = finalJumpHex(SOURCE_DATA_START);
  return {
    sourceArch: "arm64" as const,
    targetArch: "amd64" as const,
    threads: [
      {
        id: "thread:main",
        state: "stopped" as const,
        stopReason: "ptrace-stop" as const,
        stackMapping: "mapping:stack",
        sourceRegisters: {
          arch: "arm64" as const,
          pc: finalJumpHex(SOURCE_RESUME_PC),
          sp: finalJumpHex(SOURCE_STACK_START + 0xf00n),
          pstate: "0x0",
          x,
        },
        syscall: { state: "outside-syscall" as const },
        signal: {
          blocked: [],
          pending: [],
          activeFrame: false,
          altStack: { state: "disabled" as const },
        },
        tls: {
          threadPointer: finalJumpHex(SOURCE_STACK_START + 0x800n),
          rseq: { state: "absent" as const },
        },
      },
    ],
    continuations: {
      "thread:main": {
        sourcePc: finalJumpHex(SOURCE_RESUME_PC),
        targetIp: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
        targetSp: finalJumpHex(FINAL_JUMP_TARGET_STACK_POINTER),
        targetTls: "0x0",
        targetRegisterOverrides: { rdi: finalJumpHex(FINAL_JUMP_TARGET_DATA_START) },
      },
    },
  };
}

function stackInput(codeLocations: ReturnType<typeof buildNativeCodeMap>["codeLocations"]) {
  return {
    stackMapping: "mapping:stack",
    targetStackBase: finalJumpHex(FINAL_JUMP_TARGET_STACK_START + BigInt(FINAL_JUMP_STACK_SIZE)),
    codeLocations,
    frames: [
      {
        id: "frame:resume",
        sourceSp: finalJumpHex(SOURCE_STACK_START + 0xf00n),
        sourceReturnAddress: finalJumpHex(SOURCE_RESUME_PC),
        sizeBytes: 64,
        metadata: "sidecar" as const,
        locals: [
          {
            offset: 16,
            kind: "pointer" as const,
            sourceValue: finalJumpHex(SOURCE_DATA_START),
            targetValue: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
          },
        ],
      },
    ],
  };
}

function memoryInput() {
  return {
    words: [
      {
        mapping: "mapping:data",
        offset: 0,
        sourceValue: finalJumpHex(SOURCE_DATA_START),
        targetValue: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
        classification: "pointer" as const,
        proof: "sidecar" as const,
      },
    ],
  };
}

function resourceInput() {
  return {
    resources: [
      {
        id: "argv",
        kind: "argv" as const,
        state: "captured" as const,
        recipe: { argv: ["native-final-jump"] },
      },
      {
        id: "env",
        kind: "env" as const,
        state: "captured" as const,
        recipe: { env: {} },
      },
    ],
  };
}

function manifest() {
  return {
    formatVersion: 1,
    kind: "machinen.native-process-image",
    capture: { method: "external-ptrace-procfs", sourceArch: "arm64", pid: 464 },
    target: { mode: "native-cross-isa", arch: "amd64", abi: "linux-user" },
    process: {
      exe: "/controlled/native-final-jump",
      argv: ["native-final-jump"],
      env: {},
      cwd: "/tmp",
    },
    refusals: nativeEmptyRefusals(),
  };
}

function mappings() {
  return {
    formatVersion: 1,
    mappings: [
      {
        id: "mapping:arm64-text",
        kind: "text",
        sourceStart: finalJumpHex(SOURCE_TEXT_START),
        sourceEnd: finalJumpHex(SOURCE_TEXT_START + BigInt(FINAL_JUMP_PAGE_SIZE)),
        sizeBytes: FINAL_JUMP_PAGE_SIZE,
        permissions: { read: true, write: false, execute: true, private: true, shared: false },
        target: {
          materialization: "translate",
          targetStart: finalJumpHex(FINAL_JUMP_TARGET_TEXT_START),
        },
      },
      {
        id: "mapping:amd64-text",
        kind: "text",
        sourceStart: finalJumpHex(SOURCE_TEXT_START),
        sourceEnd: finalJumpHex(SOURCE_TEXT_START + BigInt(FINAL_JUMP_PAGE_SIZE)),
        sizeBytes: FINAL_JUMP_PAGE_SIZE,
        permissions: { read: true, write: false, execute: true, private: true, shared: false },
        captured: { file: "native-memory.bin", offset: 0, sizeBytes: FINAL_JUMP_PAGE_SIZE },
        target: {
          materialization: "translate",
          targetStart: finalJumpHex(FINAL_JUMP_TARGET_TEXT_START),
        },
      },
      {
        id: "mapping:data",
        kind: "data",
        sourceStart: finalJumpHex(SOURCE_DATA_START),
        sourceEnd: finalJumpHex(SOURCE_DATA_START + BigInt(FINAL_JUMP_PAGE_SIZE)),
        sizeBytes: FINAL_JUMP_PAGE_SIZE,
        permissions: { read: true, write: true, execute: false, private: true, shared: false },
        captured: {
          file: "native-memory.bin",
          offset: FINAL_JUMP_PAGE_SIZE,
          sizeBytes: FINAL_JUMP_PAGE_SIZE,
        },
        target: {
          materialization: "translate",
          targetStart: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
        },
      },
      {
        id: "mapping:stack",
        kind: "stack",
        sourceStart: finalJumpHex(SOURCE_STACK_START),
        sourceEnd: finalJumpHex(SOURCE_STACK_START + BigInt(FINAL_JUMP_STACK_SIZE)),
        sizeBytes: FINAL_JUMP_STACK_SIZE,
        permissions: { read: true, write: true, execute: false, private: true, shared: false },
        target: {
          materialization: "recreate",
          targetStart: finalJumpHex(FINAL_JUMP_TARGET_STACK_START),
        },
      },
    ],
    refusals: nativeEmptyRefusals(),
  };
}

function threads() {
  return { formatVersion: 1, threads: registerInput().threads, refusals: nativeEmptyRefusals() };
}

function printSummary(summary: ReturnType<typeof verifyNativeFinalJump>) {
  console.log(
    `native-final-jump: entry=${summary.translatedEntry} arg=${summary.translatedArgument} result=${summary.resumeEvent.returnValue}`,
  );
  console.log(`native-final-jump: execution=${summary.execution}`);
}

main();
