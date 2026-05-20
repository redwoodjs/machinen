#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { buildNativeCodeMap } from "../packages/runtime/src/native-code-map.ts";
import { translateNativeMemory } from "../packages/runtime/src/native-memory-translation.ts";
import { validateNativeProcessImageBundle } from "../packages/runtime/src/native-process-image.ts";
import type { NativeAmd64Registers } from "../packages/runtime/src/native-process-image.ts";
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
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  emitSkip,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE = "usage: tsx scripts/native-final-jump.ts [verify] [--out-dir path] [--json] [--keep]";
const PAGE_SIZE = 4096;
const STACK_SIZE = 64 * 1024;
const ENTRY_OFFSET = 128;
const TEXT_MARKER = "machinen-native-final-jump-v1";
const STORE_MARKER = 0x4e454e494843414dn;
const EXPECTED_RETURN = 0x4dn;
const SOURCE_TEXT_START = 0x400000n;
const SOURCE_RESUME_PC = 0x400120n;
const SOURCE_DATA_START = 0x600000n;
const SOURCE_STACK_START = 0x700000000000n;
const TARGET_TEXT_START = 0x14000000n;
const TARGET_DATA_START = 0x15000000n;
const TARGET_STACK_START = 0x500000000000n;
const TARGET_ENTRY = TARGET_TEXT_START + BigInt(ENTRY_OFFSET);
const TARGET_STACK_POINTER = TARGET_STACK_START + BigInt(STACK_SIZE) - 16n;

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
      bundleMemory(),
      manifest(),
      mappings(),
      threads(),
      resources.resources,
      steps,
    ),
  );
  const bundle = validateNativeProcessImageBundle(bundleDir);
  const resumeEvent = jumpIntoTargetNativeCode(trampoline, bundleDir, registers);
  validateResumeEvent(resumeEvent);

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
    translatedEntry: hex(TARGET_ENTRY),
    translatedArgument: hex(TARGET_DATA_START),
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
        address: hex(SOURCE_RESUME_PC),
        sizeBytes: 64,
        metadata: "sidecar" as const,
      },
    ],
    targetSymbols: [
      {
        name: "native_final_jump_resume",
        mapping: "mapping:amd64-text",
        address: hex(TARGET_ENTRY),
        sizeBytes: 64,
        metadata: "sidecar" as const,
      },
    ],
    requestedLocations: [{ id: "code:resume", symbol: "native_final_jump_resume" }],
  };
}

function registerInput() {
  const x = Array.from({ length: 31 }, () => "0x0");
  x[0] = hex(SOURCE_DATA_START);
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
          pc: hex(SOURCE_RESUME_PC),
          sp: hex(SOURCE_STACK_START + 0xf00n),
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
          threadPointer: hex(SOURCE_STACK_START + 0x800n),
          rseq: { state: "absent" as const },
        },
      },
    ],
    continuations: {
      "thread:main": {
        sourcePc: hex(SOURCE_RESUME_PC),
        targetIp: hex(TARGET_ENTRY),
        targetSp: hex(TARGET_STACK_POINTER),
        targetTls: "0x0",
        targetRegisterOverrides: { rdi: hex(TARGET_DATA_START) },
      },
    },
  };
}

function stackInput(codeLocations: ReturnType<typeof buildNativeCodeMap>["codeLocations"]) {
  return {
    stackMapping: "mapping:stack",
    targetStackBase: hex(TARGET_STACK_START + BigInt(STACK_SIZE)),
    codeLocations,
    frames: [
      {
        id: "frame:resume",
        sourceSp: hex(SOURCE_STACK_START + 0xf00n),
        sourceReturnAddress: hex(SOURCE_RESUME_PC),
        sizeBytes: 64,
        metadata: "sidecar" as const,
        locals: [
          {
            offset: 16,
            kind: "pointer" as const,
            sourceValue: hex(SOURCE_DATA_START),
            targetValue: hex(TARGET_DATA_START),
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
        sourceValue: hex(SOURCE_DATA_START),
        targetValue: hex(TARGET_DATA_START),
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
        sourceStart: hex(SOURCE_TEXT_START),
        sourceEnd: hex(SOURCE_TEXT_START + BigInt(PAGE_SIZE)),
        sizeBytes: PAGE_SIZE,
        permissions: { read: true, write: false, execute: true, private: true, shared: false },
        target: { materialization: "translate", targetStart: hex(TARGET_TEXT_START) },
      },
      {
        id: "mapping:amd64-text",
        kind: "text",
        sourceStart: hex(SOURCE_TEXT_START),
        sourceEnd: hex(SOURCE_TEXT_START + BigInt(PAGE_SIZE)),
        sizeBytes: PAGE_SIZE,
        permissions: { read: true, write: false, execute: true, private: true, shared: false },
        captured: { file: "native-memory.bin", offset: 0, sizeBytes: PAGE_SIZE },
        target: { materialization: "translate", targetStart: hex(TARGET_TEXT_START) },
      },
      {
        id: "mapping:data",
        kind: "data",
        sourceStart: hex(SOURCE_DATA_START),
        sourceEnd: hex(SOURCE_DATA_START + BigInt(PAGE_SIZE)),
        sizeBytes: PAGE_SIZE,
        permissions: { read: true, write: true, execute: false, private: true, shared: false },
        captured: { file: "native-memory.bin", offset: PAGE_SIZE, sizeBytes: PAGE_SIZE },
        target: { materialization: "translate", targetStart: hex(TARGET_DATA_START) },
      },
      {
        id: "mapping:stack",
        kind: "stack",
        sourceStart: hex(SOURCE_STACK_START),
        sourceEnd: hex(SOURCE_STACK_START + BigInt(STACK_SIZE)),
        sizeBytes: STACK_SIZE,
        permissions: { read: true, write: true, execute: false, private: true, shared: false },
        target: { materialization: "recreate", targetStart: hex(TARGET_STACK_START) },
      },
    ],
    refusals: nativeEmptyRefusals(),
  };
}

function threads() {
  return { formatVersion: 1, threads: registerInput().threads, refusals: nativeEmptyRefusals() };
}

function bundleMemory() {
  const text = Buffer.alloc(PAGE_SIZE);
  text.write(TEXT_MARKER, 0, "utf8");
  targetAmd64Code().copy(text, ENTRY_OFFSET);
  const data = Buffer.alloc(PAGE_SIZE);
  return Buffer.concat([text, data]);
}

function targetAmd64Code() {
  const code = Buffer.from([
    0x48,
    0x89,
    0x27,
    0x48,
    0xb8,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0x48,
    0x89,
    0x47,
    0x08,
    0xb8,
    Number(EXPECTED_RETURN),
    0,
    0,
    0,
    0xc3,
  ]);
  code.writeBigUInt64LE(STORE_MARKER, 5);
  return code;
}

function jumpIntoTargetNativeCode(
  trampoline: string,
  bundleDir: string,
  registers: ReturnType<typeof translateNativeRegisterState>,
) {
  const targetRegisters = requireAmd64Registers(registers);
  assert(
    targetRegisters.rip === hex(TARGET_ENTRY),
    "final-jump target rip does not match code map",
  );
  assert(targetRegisters.rdi === hex(TARGET_DATA_START), "final-jump target rdi was not relocated");
  assert(
    targetRegisters.rsp === hex(TARGET_STACK_POINTER),
    "final-jump target rsp does not match stack plan",
  );

  const result = spawnSync(
    trampoline,
    [
      "--memory",
      join(bundleDir, "native-memory.bin"),
      "--text-offset",
      "0",
      "--text-size",
      String(PAGE_SIZE),
      "--text-target-start",
      hex(TARGET_TEXT_START),
      "--entry-offset",
      String(ENTRY_OFFSET),
      "--expect-prefix",
      TEXT_MARKER,
      "--data-offset",
      String(PAGE_SIZE),
      "--data-size",
      String(PAGE_SIZE),
      "--data-target-start",
      hex(TARGET_DATA_START),
      "--stack-target-start",
      hex(TARGET_STACK_START),
      "--stack-size",
      String(STACK_SIZE),
      "--arg0",
      targetRegisters.rdi,
      "--expect-return",
      hex(EXPECTED_RETURN),
      "--expect-store-marker",
      hex(STORE_MARKER),
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  assert(result.status === 0, `native final-jump trampoline failed: ${result.stderr}`);
  const line = result.stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("MACHINEN_NATIVE_RESUME_TRAMPOLINE "));
  assert(line, "native final-jump trampoline did not emit a resume event");
  return JSON.parse(line.slice("MACHINEN_NATIVE_RESUME_TRAMPOLINE ".length));
}

function requireAmd64Registers(
  registers: ReturnType<typeof translateNativeRegisterState>,
): NativeAmd64Registers {
  const targetRegisters = registers.threads[0]?.targetRegisters;
  if (!targetRegisters || targetRegisters.arch !== "amd64") {
    throw new Error("final-jump thread did not translate to amd64");
  }
  return targetRegisters;
}

function validateResumeEvent(resumeEvent: { [key: string]: unknown }) {
  assert(resumeEvent.status === "jumped", "native final jump did not execute target code");
  assert(resumeEvent.targetArch === "amd64", "native final jump executed the wrong target arch");
  assert(resumeEvent.entry === hex(TARGET_ENTRY), "native final jump used the wrong entry");
  assert(resumeEvent.argument === hex(TARGET_DATA_START), "native final jump used the wrong arg0");
  assert(
    resumeEvent.returnValue === hex(EXPECTED_RETURN),
    "native final jump returned the wrong value",
  );
  assert(
    resumeEvent.storedMarker === hex(STORE_MARKER),
    "native final jump stored the wrong marker",
  );
  assert(resumeEvent.usedTargetStack === true, "native final jump did not use the target stack");
}

function hex(value: bigint) {
  return `0x${value.toString(16)}`;
}

function printSummary(summary: ReturnType<typeof verifyNativeFinalJump>) {
  console.log(
    `native-final-jump: entry=${summary.translatedEntry} arg=${summary.translatedArgument} result=${summary.resumeEvent.returnValue}`,
  );
  console.log(`native-final-jump: execution=${summary.execution}`);
}

main();
