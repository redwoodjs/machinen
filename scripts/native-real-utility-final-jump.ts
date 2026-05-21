#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { materializeNativeTargetModuleBytes } from "../packages/runtime/src/native-target-module-bytes.ts";
import type { NativeRealUtilityTargetModule } from "../packages/runtime/src/native-real-utility-code-map.ts";
import { planNativeRealUtilityContinuationAttempt } from "../packages/runtime/src/native-real-utility-continuation.ts";
import { matchNativeTargetUnwindFrame } from "../packages/runtime/src/native-target-unwind.ts";
import type { NativeDiscoveredUnwindFrame } from "../packages/runtime/src/native-unwind-frames.ts";
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import {
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  NATIVE_RESUME_TRAMPOLINE_SOURCE,
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
import {
  FINAL_JUMP_PAGE_SIZE,
  FINAL_JUMP_TARGET_DATA_START,
  FINAL_JUMP_TARGET_ENTRY,
  FINAL_JUMP_TARGET_STACK_POINTER,
  FINAL_JUMP_TARGET_STACK_START,
  finalJumpBundleMemoryFromTargetText,
  finalJumpHex,
  finalJumpTargetCode,
  jumpIntoFinalTargetNativeCode,
  requireFinalJumpAmd64Registers,
  validateFinalJumpResumeEvent,
} from "./native-final-jump-utils.ts";

const USAGE =
  "usage: tsx scripts/native-real-utility-final-jump.ts [verify] [--out-dir path] [--json] [--keep]";
const TEXT_MARKER = "machinen-native-real-utility-final-jump-v1";
const SOURCE_TEXT_START = 0x400000n;
const SOURCE_PC = 0x401234n;
const SOURCE_DATA_START = 0x600000n;
const SOURCE_STACK_START = 0x700000000000n;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux" || process.arch !== "x64") {
    emitSkip(
      args,
      "native-real-utility-final-jump",
      "target-native final jump requires Linux/amd64",
    );
    return;
  }
  const workspace = createWorkspace(args, "machinen-native-real-utility-final-jump-");
  try {
    emitResult(verifyNativeRealUtilityFinalJump(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeRealUtilityFinalJump(outDir: string) {
  ensureSourcesExist([NATIVE_RESUME_TRAMPOLINE_SOURCE]);
  const { binDir, bundleDir } = createProofBinAndBundleDirs(outDir);
  const trampoline = compileNativeResumeTrampoline(binDir);
  const target = materializeTargetCode(outDir);
  const sourceFrame = proofSourceFrame();
  const targetUnwind = matchNativeTargetUnwindFrame({
    sourceFrame,
    targetAddress: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    targetRules: [targetUnwindRule()],
  });
  const plan = planNativeRealUtilityContinuationAttempt({
    codeLocations: [codeLocation()],
    sourceFrames: [sourceFrame],
    targetUnwind,
  });
  assert(
    plan.state === "ready",
    `real utility final-jump gates were not ready: ${JSON.stringify(plan)}`,
  );
  const registers = translateNativeRegisterState(registerInput());
  const resources = translateNativeResources(resourceInput());
  writeNativeProcessImageBundle(
    bundleDir,
    nativeProofBundleDocuments(
      finalJumpBundleMemoryFromTargetText(
        TEXT_MARKER,
        Buffer.from(target.materialized.bytes),
        FINAL_JUMP_TARGET_DATA_START,
      ),
      manifest(),
      mappings(),
      threads(),
      resources.resources,
      {
        codeMap: codeMapResult(),
        registers,
        stack: emptyRelocations(),
        memory: emptyRelocations(),
        resources,
      },
    ),
  );
  const targetRegisters = requireFinalJumpAmd64Registers(
    registers.threads[0],
    "real-utility-final-jump",
  );
  const resumeEvent = jumpIntoFinalTargetNativeCode({
    label: "real-utility-final-jump",
    trampoline,
    bundleDir,
    targetRegisters,
    textMarker: TEXT_MARKER,
    expectedInitialDataWord0: FINAL_JUMP_TARGET_DATA_START,
  });
  validateFinalJumpResumeEvent(resumeEvent, "native real utility final jump");
  return {
    formatVersion: 1,
    phase: "native-real-utility-final-jump",
    bundleDir,
    targetRoot: target.targetRoot,
    targetModule: target.targetModule,
    materializedTargetBytes: {
      moduleId: target.materialized.moduleId,
      buildId: target.materialized.buildId,
      sizeBytes: target.materialized.sizeBytes,
      sourceTextReusedAsTargetCode: target.materialized.sourceTextReusedAsTargetCode,
    },
    plan,
    attemptedResume: true,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
    execution: "real-utility-shaped-continuation-jumped-target-native-amd64-code",
    resumeEvent,
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function materializeTargetCode(outDir: string) {
  const targetRoot = join(outDir, "target-root");
  const targetPath = join(targetRoot, "usr/bin/realspin-code");
  mkdirSync(join(targetRoot, "usr/bin"), { recursive: true });
  const targetBytes = finalJumpTargetCode();
  writeFileSync(targetPath, targetBytes);
  const targetModule = proofTargetModule(sha256(targetBytes));
  const materialized = materializeNativeTargetModuleBytes({
    module: targetModule,
    targetRoot,
    relativeStart: "0x0",
    sizeBytes: targetBytes.length,
  });
  assert(
    materialized.materialized && materialized.refusals.length === 0,
    `target bytes did not materialize: ${JSON.stringify(materialized.refusals)}`,
  );
  return { targetRoot, targetModule, materialized: materialized.materialized };
}

function proofTargetModule(buildId: string): NativeRealUtilityTargetModule {
  return {
    id: "target:realspin-code",
    logicalName: "realspin-code",
    path: "/usr/bin/realspin-code",
    arch: "amd64",
    kind: "pie-executable",
    buildId,
    loadBias: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    textMapping: "target:mapping:realspin-code",
    executable: true,
    executableRanges: [{ relativeStart: "0x0", relativeEnd: "0x100" }],
  };
}

function proofSourceFrame(): NativeDiscoveredUnwindFrame {
  return {
    id: "frame:thread:realspin_loop",
    functionName: "realspin_loop",
    sourcePc: finalJumpHex(SOURCE_PC),
    sourceSp: finalJumpHex(SOURCE_STACK_START + 0xf00n),
    cfa: finalJumpHex(SOURCE_STACK_START + 0xf40n),
    returnAddress: finalJumpHex(SOURCE_PC + 0x40n),
    returnAddressSlot: finalJumpHex(SOURCE_STACK_START + 0xf38n),
    metadata: "eh-frame",
    stackFrame: {
      id: "frame:thread:realspin_loop",
      sourceSp: finalJumpHex(SOURCE_STACK_START + 0xf00n),
      sourceReturnAddress: finalJumpHex(SOURCE_PC + 0x40n),
      sizeBytes: 64,
      metadata: "dwarf",
      locals: [],
    },
  };
}

function targetUnwindRule() {
  return {
    id: "target:realspin-final-jump",
    functionName: "realspin_loop",
    mapping: "target:mapping:realspin-code",
    pcStart: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    pcEnd: finalJumpHex(FINAL_JUMP_TARGET_ENTRY + 0x100n),
    metadata: "eh-frame" as const,
    cfa: { register: "rsp" as const, offset: 8 },
    returnAddress: { location: "cfa-relative" as const, offset: -8 },
    calleeSaved: [],
  };
}

function codeLocation() {
  return {
    id: "code:thread:pc",
    sourceMapping: "mapping:source-text",
    sourceAddress: finalJumpHex(SOURCE_PC),
    targetAddress: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    state: "mapped" as const,
  };
}

function codeMapResult() {
  return { codeLocations: [codeLocation()], refusals: [] };
}

function registerInput() {
  const x = Array.from({ length: 31 }, () => "0x0");
  x[0] = finalJumpHex(SOURCE_DATA_START);
  return {
    sourceArch: "arm64" as const,
    targetArch: "amd64" as const,
    threads: [threads().threads[0]],
    continuations: {
      "thread:main": {
        sourcePc: finalJumpHex(SOURCE_PC),
        targetIp: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
        targetSp: finalJumpHex(FINAL_JUMP_TARGET_STACK_POINTER),
        targetTls: "0x0",
        targetRegisterOverrides: { rdi: finalJumpHex(FINAL_JUMP_TARGET_DATA_START) },
      },
    },
  };
}

function resourceInput() {
  return {
    resources: [
      {
        id: "argv",
        kind: "argv" as const,
        state: "captured" as const,
        recipe: { argv: ["realspin"] },
      },
      { id: "env", kind: "env" as const, state: "captured" as const, recipe: { env: {} } },
    ],
  };
}

function manifest() {
  return {
    formatVersion: 1,
    kind: "machinen.native-process-image" as const,
    capture: { method: "external-ptrace-procfs" as const, sourceArch: "arm64" as const, pid: 504 },
    target: {
      mode: "native-cross-isa" as const,
      arch: "amd64" as const,
      abi: "linux-user" as const,
    },
    process: { exe: "/usr/bin/realspin", argv: ["realspin"], env: {}, cwd: "/tmp" },
    refusals: nativeEmptyRefusals(),
  };
}

function mappings() {
  return {
    formatVersion: 1,
    mappings: [
      {
        id: "mapping:source-text",
        kind: "text" as const,
        sourceStart: finalJumpHex(SOURCE_TEXT_START),
        sourceEnd: finalJumpHex(SOURCE_TEXT_START + BigInt(FINAL_JUMP_PAGE_SIZE)),
        sizeBytes: FINAL_JUMP_PAGE_SIZE,
        permissions: { read: true, write: false, execute: true, private: true, shared: false },
        target: { materialization: "omit" as const, reason: "source text is not target code" },
      },
      {
        id: "mapping:data",
        kind: "data" as const,
        sourceStart: finalJumpHex(SOURCE_DATA_START),
        sourceEnd: finalJumpHex(SOURCE_DATA_START + BigInt(FINAL_JUMP_PAGE_SIZE)),
        sizeBytes: FINAL_JUMP_PAGE_SIZE,
        permissions: { read: true, write: true, execute: false, private: true, shared: false },
        target: {
          materialization: "translate" as const,
          targetStart: finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
        },
      },
      {
        id: "mapping:stack",
        kind: "stack" as const,
        sourceStart: finalJumpHex(SOURCE_STACK_START),
        sourceEnd: finalJumpHex(SOURCE_STACK_START + 0x10000n),
        sizeBytes: 0x10000,
        permissions: { read: true, write: true, execute: false, private: true, shared: false },
        target: {
          materialization: "recreate" as const,
          targetStart: finalJumpHex(FINAL_JUMP_TARGET_STACK_START),
        },
      },
    ],
    refusals: nativeEmptyRefusals(),
  };
}

function threads() {
  const x = Array.from({ length: 31 }, () => "0x0");
  x[0] = finalJumpHex(SOURCE_DATA_START);
  return {
    formatVersion: 1,
    threads: [
      {
        id: "thread:main",
        state: "stopped" as const,
        stopReason: "ptrace-stop" as const,
        stackMapping: "mapping:stack",
        sourceRegisters: {
          arch: "arm64" as const,
          pc: finalJumpHex(SOURCE_PC),
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
    refusals: nativeEmptyRefusals(),
  };
}

function emptyRelocations() {
  return { relocations: [], refusals: [] };
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function printSummary(
  summary: ReturnType<typeof verifyNativeRealUtilityFinalJump> | { skipped: true; reason: string },
) {
  if ("skipped" in summary) {
    console.log(`native-real-utility-final-jump: skipped ${summary.reason}`);
    return;
  }
  console.log(
    `native-real-utility-final-jump: execution=${summary.execution} status=${summary.resumeEvent.status}`,
  );
}

main();
