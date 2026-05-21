#!/usr/bin/env tsx
import { planNativeRealUtilityContinuationAttempt } from "../packages/runtime/src/native-real-utility-continuation.ts";
import { resolveNativeRealUtilityCodeLocations } from "../packages/runtime/src/native-real-utility-code-map.ts";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import {
  discoverNativeUnwindFrames,
  nativeUnwindReturnAddressSlot,
  parseNativeEhFrameText,
} from "../packages/runtime/src/native-unwind-frames.ts";
import type {
  NativeMemoryMapping,
  NativeProcessImageDocuments,
  NativeProcessResource,
  NativeThreadState,
} from "../packages/runtime/src/native-process-image.ts";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  emitSkip,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-real-utility-continuation.ts [verify] [--out-dir path] [--json] [--keep]";
const emptyRefusals = { vocabularyVersion: 1 as const, refusals: [] };

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "native-real-utility-continuation",
      "real utility continuation proof is Linux-only",
    );
    return;
  }
  const workspace = createWorkspace(args, "machinen-native-real-utility-continuation-");
  try {
    emitResult(verifyNativeRealUtilityContinuation(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeRealUtilityContinuation() {
  const documents = proofDocuments();
  const codeMap = resolveNativeRealUtilityCodeLocations(codeMapRequest(documents));
  const resources = translateNativeResources({
    resources: proofResources(),
    inheritedStdio: { mode: "inherit-output" },
  });
  const unwind = discoverProofFrame(documents.threads.threads[0]);
  const plan = planNativeRealUtilityContinuationAttempt({
    resourceRefusals: resources.refusals,
    mappingRefusals: [],
    codeLocations: codeMap.codeLocations,
    sourceFrames: unwind.frames,
    targetUnwindMatched: false,
  });
  assert(codeMap.refusals.length === 0, "real utility continuation code map refused unexpectedly");
  assert(
    resources.refusals.length === 0,
    "real utility continuation resources refused unexpectedly",
  );
  assert(unwind.refusals.length === 0, "real utility continuation unwind refused unexpectedly");
  assert(
    plan.blockingRefusal?.code === "target-unwind-mismatch",
    "continuation did not stop at target unwind",
  );
  return {
    formatVersion: 1,
    phase: "native-real-utility-continuation",
    codeLocations: codeMap.codeLocations,
    resourceRecipes: resources.resources.flatMap((resource) =>
      resource.recipe ? [{ id: resource.id, recipe: resource.recipe }] : [],
    ),
    sourceFrames: unwind.frames,
    plan,
    attemptedResume: plan.attemptedResume,
    sourceTextReusedAsTargetCode: plan.sourceTextReusedAsTargetCode,
    sourceIsaEmulationUsed: plan.sourceIsaEmulationUsed,
    sidecarRuntimeUsed: plan.sidecarRuntimeUsed,
    execution: "real-utility-native-continuation-refused-at-target-unwind-mismatch",
  };
}

function codeMapRequest(documents: NativeProcessImageDocuments) {
  return {
    documents,
    targetArch: "amd64" as const,
    targetModules: [
      {
        id: "target:realspin",
        logicalName: "realspin",
        path: "/target/usr/bin/realspin",
        arch: "amd64" as const,
        kind: "pie-executable" as const,
        buildId: "target-realspin-amd64",
        loadBias: "0x700000000000",
        textMapping: "target:mapping:realspin",
        executable: true,
        executableRanges: [{ relativeStart: "0x0", relativeEnd: "0x3000" }],
      },
    ],
    moduleExpectations: [
      {
        sourcePath: "/usr/bin/realspin",
        targetModuleId: "target:realspin",
        expectedTargetBuildId: "target-realspin-amd64",
      },
    ],
  };
}

function discoverProofFrame(thread: NativeThreadState) {
  const parsed = parseNativeEhFrameText({
    readelfFrames: readelfFrames(),
    mapping: "mapping:exe-text",
    functionName: "realspin_loop",
    pc: "0x401234",
  });
  assert(parsed.refusals.length === 0, "proof .eh_frame parse refused unexpectedly");
  const rule = parsed.rules[0];
  assert(rule, "proof .eh_frame parse produced no rule");
  const registers = thread.sourceRegisters;
  if (registers.arch !== "arm64") {
    throw new Error("proof thread must be arm64");
  }
  const returnAddressSlot = nativeUnwindReturnAddressSlot({
    rule,
    sourceRegisters: registers,
  });
  assert(returnAddressSlot === "0x7fff0038", "proof return-address slot changed");
  return discoverNativeUnwindFrames({
    threadId: thread.id,
    stackMapping: thread.stackMapping,
    sourceRegisters: registers,
    rules: [rule],
    stackWords: [{ address: returnAddressSlot, value: "0x401280" }],
  });
}

function proofDocuments(): NativeProcessImageDocuments {
  return {
    manifest: {
      formatVersion: 1,
      kind: "machinen.native-process-image",
      capture: { method: "external-ptrace-procfs", sourceArch: "arm64", pid: 1200 },
      target: { mode: "native-cross-isa", arch: "amd64", abi: "linux-user" },
      process: { exe: "/usr/bin/realspin", argv: ["realspin"], env: {}, cwd: "/tmp" },
      refusals: emptyRefusals,
    },
    mappings: { formatVersion: 1, mappings: [sourceMapping()], refusals: emptyRefusals },
    threads: { formatVersion: 1, threads: [sourceThread()], refusals: emptyRefusals },
    resources: { formatVersion: 1, resources: proofResources(), refusals: emptyRefusals },
    translation: {
      formatVersion: 1,
      mode: "native-cross-isa",
      sourceArch: "arm64",
      targetArch: "amd64",
      codeLocations: [],
      threads: [],
      memoryRelocations: [],
      refusals: emptyRefusals,
    },
  };
}

function sourceMapping(): NativeMemoryMapping {
  return {
    id: "mapping:exe-text",
    kind: "text",
    sourceStart: "0x400000",
    sourceEnd: "0x402000",
    sizeBytes: 8192,
    permissions: { read: true, write: false, execute: true, private: true, shared: false },
    file: { path: "/usr/bin/realspin", offset: 0, buildId: "source-realspin-arm64" },
    target: { materialization: "omit", reason: "source text is never reused as target code" },
  };
}

function sourceThread(): NativeThreadState {
  return {
    id: "thread:1",
    lwpid: 1201,
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: "mapping:stack",
    sourceRegisters: {
      arch: "arm64",
      pc: "0x401234",
      sp: "0x7fff0000",
      pstate: "0x0",
      x: Array.from({ length: 31 }, (_, index) => (index === 29 ? "0x7fff0030" : "0x0")),
    },
    syscall: { state: "outside-syscall" },
    signal: { blocked: [], pending: [], activeFrame: false, altStack: { state: "disabled" } },
    tls: { threadPointer: "0x0", rseq: { state: "absent" } },
  };
}

function proofResources(): NativeProcessResource[] {
  return [
    { id: "fd:1", kind: "pipe", state: "captured", fd: 1, path: "pipe:[stdout]" },
    { id: "fd:2", kind: "socket", state: "captured", fd: 2, path: "socket:[stderr]" },
    { id: "fd:3", kind: "file", state: "captured", fd: 3, path: "/tmp/realspin.txt", offset: 0 },
  ];
}

function readelfFrames() {
  return `
00000088 0000000000000024 0000001c FDE cie=00000070 pc=0000000000401200..0000000000401280
  DW_CFA_advance_loc: 4 to 0000000000401124
  DW_CFA_def_cfa_offset: 16
  DW_CFA_offset: r29 (x29) at cfa-16
  DW_CFA_offset: r30 (x30) at cfa-8
  DW_CFA_advance_loc: 4 to 0000000000401128
  DW_CFA_def_cfa_register: r29 (x29)
`;
}

function printSummary(
  summary:
    | ReturnType<typeof verifyNativeRealUtilityContinuation>
    | { skipped: true; reason: string },
) {
  if ("skipped" in summary) {
    console.log(`native-real-utility-continuation: skipped ${summary.reason}`);
    return;
  }
  console.log(
    `native-real-utility-continuation: state=${summary.plan.state} boundary=${summary.plan.blockingBoundary} refusal=${summary.plan.blockingRefusal?.code}`,
  );
  console.log(`native-real-utility-continuation: execution=${summary.execution}`);
}

main();
