#!/usr/bin/env tsx
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import { planNativeThreadRestoreBoundary } from "../packages/runtime/src/native-thread-restore-policy.ts";
import type {
  NativeMemoryMapping,
  NativeProcessImageRefusalCode,
  NativeProcessResource,
  NativeThreadState,
} from "../packages/runtime/src/native-process-image.ts";
import {
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-thread-refusal-matrix.ts [verify] [--out-dir path] [--json] [--keep]";

interface RefusalCase {
  id: string;
  expectedCode: NativeProcessImageRefusalCode;
  mutate: (thread: NativeThreadState) => void;
}

interface RestoreRefusalCase {
  id: string;
  expectedCode: NativeProcessImageRefusalCode;
  threads?: NativeThreadState[];
  mappings?: NativeMemoryMapping[];
  resources?: NativeProcessResource[];
  mutate?: (thread: NativeThreadState) => void;
}

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-thread-refusal-matrix-");
  try {
    emitResult(verifyNativeThreadRefusalMatrix(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeThreadRefusalMatrix() {
  const translated = translateNativeRegisterState({
    sourceArch: "arm64",
    targetArch: "amd64",
    threads: [zeroSignalMaskThread("thread:safe")],
    continuations: continuationFor("thread:safe"),
  });
  assertCase(
    translated.threads[0]?.state === "translated",
    "zero signal masks should remain translatable",
  );

  // fallow-ignore-next-line complexity
  const cases = refusalCases().map((entry) => {
    const thread = zeroSignalMaskThread(`thread:${entry.id}`);
    entry.mutate(thread);
    const result = translateNativeRegisterState({
      sourceArch: "arm64",
      targetArch: "amd64",
      threads: [thread],
      continuations: continuationFor(thread.id),
    });
    const refusal = result.threads[0]?.refusal;
    assertCase(
      refusal?.code === entry.expectedCode,
      `${entry.id} refused with ${refusal?.code ?? "none"}, expected ${entry.expectedCode}`,
    );
    return { id: entry.id, refusalCode: refusal.code, message: refusal.message };
  });

  const restoreBoundary = verifyRestoreBoundary();

  const architecture = translateNativeRegisterState({
    sourceArch: "amd64",
    targetArch: "arm64",
    threads: [zeroSignalMaskThread("thread:architecture")],
    continuations: {},
  });
  assertCase(
    architecture.threads[0]?.refusal?.code === "architecture-pair-unsupported",
    "unsupported architecture pair did not refuse precisely",
  );

  return {
    formatVersion: 1,
    translated: translated.threads[0],
    refusalCases: cases,
    restoreBoundary,
    architectureRefusal: architecture.threads[0]?.refusal,
  };
}

function verifyRestoreBoundary() {
  const accepted = planNativeThreadRestoreBoundary({
    threads: [zeroSignalMaskThread("thread:restore-safe")],
    mappings: [stackMapping(false)],
  });
  assertCase(accepted.state === "accepted", "single safe thread should be accepted");
  const refusalCases = restoreRefusalCases().map(verifyRestoreBoundaryCase);
  return { accepted, refusalCases };
}

function verifyRestoreBoundaryCase(entry: RestoreRefusalCase) {
  const plan = restoreBoundaryPlan(entry);
  assertCase(plan.state === "refused", `${entry.id} restore boundary did not refuse`);
  const refusal = plan.refusals[0]!;
  assertRestoreRefusalCode(entry, refusal.code);
  return { id: entry.id, refusalCode: refusal.code, message: refusal.message };
}

function assertRestoreRefusalCode(entry: RestoreRefusalCase, code: string): void {
  assertCase(
    code === entry.expectedCode,
    `${entry.id} restore boundary refused with ${code}, expected ${entry.expectedCode}`,
  );
}

function restoreBoundaryPlan(entry: RestoreRefusalCase) {
  const thread = zeroSignalMaskThread(`thread:${entry.id}`);
  mutateRestoreThread(entry, thread);
  return planNativeThreadRestoreBoundary({
    threads: restoreThreads(entry, thread),
    mappings: restoreMappings(entry),
    resources: restoreResources(entry),
  });
}

function mutateRestoreThread(entry: RestoreRefusalCase, thread: NativeThreadState): void {
  if (entry.mutate) {
    entry.mutate(thread);
  }
}

function restoreThreads(entry: RestoreRefusalCase, thread: NativeThreadState): NativeThreadState[] {
  return entry.threads ? entry.threads : [thread];
}

function restoreMappings(entry: RestoreRefusalCase): NativeMemoryMapping[] {
  return entry.mappings ? entry.mappings : [stackMapping(false)];
}

function restoreResources(entry: RestoreRefusalCase): NativeProcessResource[] {
  return entry.resources ? entry.resources : [];
}

function restoreRefusalCases(): RestoreRefusalCase[] {
  return [
    {
      id: "multi-thread",
      expectedCode: "thread-state-unsupported",
      threads: [zeroSignalMaskThread("thread:one"), zeroSignalMaskThread("thread:two")],
    },
    {
      id: "futex-wait",
      expectedCode: "futex-state-unsupported",
      resources: [{ id: "resource:futex", kind: "futex", state: "captured" }],
    },
    {
      id: "signal-delivery-stop",
      expectedCode: "signal-state-unsupported",
      mutate: (thread) => {
        thread.stopReason = "signal-delivery-stop";
      },
    },
    {
      id: "ptrace-debug",
      expectedCode: "thread-state-unsupported",
      resources: [
        {
          id: "resource:ptrace-debug",
          kind: "unknown",
          state: "refused",
          refusal: { code: "thread-state-unsupported", message: "ptrace/debug state" },
        },
      ],
    },
    {
      id: "shared-stack",
      expectedCode: "mapping-shared-unsupported",
      mappings: [stackMapping(true)],
    },
    {
      id: "unknown-tls",
      expectedCode: "tls-state-unsupported",
      mutate: (thread) => {
        thread.tls.threadPointer = "unknown";
      },
    },
    {
      id: "wrong-tls-source-register",
      expectedCode: "tls-state-unsupported",
      mutate: (thread) => {
        thread.tls.sourceRegister = "amd64-fs-base";
      },
    },
    {
      id: "unsupported-target-segment-bases",
      expectedCode: "tls-state-unsupported",
      mutate: (thread) => {
        thread.tls.targetSegmentBases = { state: "unsupported", reason: "target TCB missing" };
      },
    },
    {
      id: "ambiguous-registers",
      expectedCode: "thread-state-unsupported",
      mutate: (thread) => {
        if (thread.sourceRegisters.arch === "arm64") {
          thread.sourceRegisters.pc = "unknown";
        }
      },
    },
    {
      id: "missing-simd-fpu-state",
      expectedCode: "simd-fpu-state-unsupported",
      mutate: (thread) => {
        thread.simdFpu = undefined;
      },
    },
    {
      id: "live-simd-fpu-state",
      expectedCode: "simd-fpu-state-unsupported",
      mutate: (thread) => {
        thread.simdFpu = { state: "requires-restore", arch: "arm64", byteLength: 528 };
      },
    },
    {
      id: "partial-simd-fpu-subset",
      expectedCode: "simd-fpu-state-unsupported",
      mutate: (thread) => {
        thread.simdFpu = {
          state: "requires-restore",
          arch: "arm64",
          byteLength: 528,
          liveSubset: "caller-saved-vector-registers",
        };
      },
    },
    {
      id: "unsupported-simd-fpu-state",
      expectedCode: "simd-fpu-state-unsupported",
      mutate: (thread) => {
        thread.simdFpu = { state: "unsupported", reason: "ptrace fpstate unavailable" };
      },
    },
  ];
}

const REGISTER_REFUSAL_CASES: RefusalCase[] = [
  {
    id: "inside-syscall",
    expectedCode: "active-syscall",
    mutate: (thread) => {
      thread.syscall = { state: "inside-syscall", number: 64, name: "write" };
    },
  },
  {
    id: "restart-block",
    expectedCode: "active-syscall",
    mutate: (thread) => {
      thread.syscall = { state: "restart-block", number: 219, name: "restart_syscall" };
    },
  },
  {
    id: "signal-frame",
    expectedCode: "signal-frame-active",
    mutate: (thread) => {
      thread.signal.activeFrame = true;
    },
  },
  {
    id: "pending-signal-mask",
    expectedCode: "signal-state-unsupported",
    mutate: (thread) => {
      thread.signal.pending = ["0000000000000002"];
    },
  },
  {
    id: "blocked-signal-mask",
    expectedCode: "signal-state-unsupported",
    mutate: (thread) => {
      thread.signal.blocked = ["0x4"];
    },
  },
  {
    id: "alt-stack",
    expectedCode: "signal-state-unsupported",
    mutate: (thread) => {
      thread.signal.altStack = { state: "enabled", sp: "0x7000", sizeBytes: 4096 };
    },
  },
  {
    id: "rseq-captured",
    expectedCode: "rseq-state-unsupported",
    mutate: (thread) => {
      thread.tls.rseq = { state: "captured" };
    },
  },
  {
    id: "rseq-unsupported",
    expectedCode: "rseq-state-unsupported",
    mutate: (thread) => {
      thread.tls.rseq = { state: "unsupported" };
    },
  },
];

function refusalCases(): RefusalCase[] {
  return REGISTER_REFUSAL_CASES;
}

function zeroSignalMaskThread(id: string): NativeThreadState {
  return {
    id,
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: "mapping:stack",
    sourceRegisters: arm64Registers(),
    syscall: { state: "outside-syscall" },
    signal: zeroSignalState(),
    tls: {
      threadPointer: "0xffff0000",
      sourceRegister: "arm64-tpidr-el0",
      rseq: { state: "absent" },
    },
    simdFpu: { state: "not-live", provenance: "matrix-zero-fpstate" },
  };
}

function arm64Registers() {
  const x = Array.from({ length: 31 }, (_value, index) => `0x${(index + 1).toString(16)}`);
  return { arch: "arm64" as const, pc: "0x400120", sp: "0x7fff0000", pstate: "0x0", x };
}

function zeroSignalState() {
  return {
    blocked: ["0000000000000000"],
    pending: ["0x0"],
    activeFrame: false,
    altStack: { state: "disabled" as const },
  };
}

function stackMapping(shared: boolean): NativeMemoryMapping {
  return {
    id: "mapping:stack",
    kind: shared ? "shared" : "stack",
    sourceStart: "0x700000000000",
    sourceEnd: "0x700000001000",
    sizeBytes: 4096,
    permissions: { read: true, write: true, execute: false, private: !shared, shared },
    target: { materialization: "translate", targetStart: "0x500000000000" },
  };
}

function continuationFor(threadId: string) {
  return {
    [threadId]: {
      sourcePc: "0x400120",
      targetIp: "0x14000120",
      targetSp: "0x7fffffffe000",
      targetTls: "0x0",
    },
  };
}

function assertCase(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function printSummary(summary: ReturnType<typeof verifyNativeThreadRefusalMatrix>) {
  console.log(
    `native-thread-refusal-matrix: translated=${summary.translated.state} refusals=${summary.refusalCases.length}`,
  );
  console.log(
    `native-thread-refusal-matrix: restore=${summary.restoreBoundary.accepted.state} restoreRefusals=${summary.restoreBoundary.refusalCases.length}`,
  );
  for (const entry of summary.refusalCases) {
    console.log(`native-thread-refusal-matrix: ${entry.id} -> ${entry.refusalCode}`);
  }
  for (const entry of summary.restoreBoundary.refusalCases) {
    console.log(`native-thread-refusal-matrix: restore ${entry.id} -> ${entry.refusalCode}`);
  }
}

main();
