#!/usr/bin/env tsx
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import type {
  NativeProcessImageRefusalCode,
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
    architectureRefusal: architecture.threads[0]?.refusal,
  };
}

function refusalCases(): RefusalCase[] {
  return [
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
}

function zeroSignalMaskThread(id: string): NativeThreadState {
  const x = Array.from({ length: 31 }, (_value, index) => `0x${(index + 1).toString(16)}`);
  return {
    id,
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: "mapping:stack",
    sourceRegisters: { arch: "arm64", pc: "0x400120", sp: "0x7fff0000", pstate: "0x0", x },
    syscall: { state: "outside-syscall" },
    signal: {
      blocked: ["0000000000000000"],
      pending: ["0x0"],
      activeFrame: false,
      altStack: { state: "disabled" },
    },
    tls: { threadPointer: "0xffff0000", rseq: { state: "absent" } },
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
  for (const entry of summary.refusalCases) {
    console.log(`native-thread-refusal-matrix: ${entry.id} -> ${entry.refusalCode}`);
  }
}

main();
