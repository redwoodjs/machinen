#!/usr/bin/env tsx
import { classifyNativeActiveSyscalls } from "../packages/runtime/src/native-active-syscall-policy.ts";
import type { NativeThreadState } from "../packages/runtime/src/native-process-image.ts";
import {
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-active-syscall-policy.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-active-syscall-policy-");
  try {
    emitResult(verifyNativeActiveSyscallPolicy(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeActiveSyscallPolicy() {
  const result = classifyNativeActiveSyscalls([
    thread("thread:outside", { state: "outside-syscall" }),
    thread("thread:sleep", { state: "inside-syscall", number: 115, name: "clock_nanosleep" }),
    thread("thread:fd", { state: "inside-syscall", number: 63, name: "read" }),
    thread("thread:restart", { state: "restart-block", number: 128, name: "restart_syscall" }),
    thread("thread:unknown", { state: "inside-syscall", number: 9999, name: "unknown" }),
  ]);
  return {
    formatVersion: 1,
    phase: "native-active-syscall-policy",
    classifications: result.classifications,
    refusals: result.refusals,
    execution: "active-native-syscall-blockers-classified-fail-closed",
  };
}

function thread(id: string, syscall: NativeThreadState["syscall"]): NativeThreadState {
  return {
    id,
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: "mapping:stack",
    sourceRegisters: { arch: "arm64", pc: "0x1000", sp: "0x2000", pstate: "0x0", x: [] },
    syscall,
    signal: { blocked: [], pending: [], activeFrame: false, altStack: { state: "disabled" } },
    tls: { threadPointer: "0x0", rseq: { state: "absent" } },
  };
}

function printSummary(summary: ReturnType<typeof verifyNativeActiveSyscallPolicy>) {
  console.log(
    `native-active-syscall-policy: classes=${summary.classifications
      .map((classification) => classification.class)
      .join(",")} refusals=${summary.refusals.length}`,
  );
  console.log(`native-active-syscall-policy: execution=${summary.execution}`);
}

main();
