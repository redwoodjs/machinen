#!/usr/bin/env tsx
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import type { NativeThreadState } from "../packages/runtime/src/native-process-image.ts";
import {
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-register-translate.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-register-translate-");
  try {
    emitResult(verifyNativeRegisterTranslation(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

// fallow-ignore-next-line complexity
function verifyNativeRegisterTranslation() {
  const safeThread = thread("thread:safe");
  const unsafeThread = thread("thread:syscall");
  unsafeThread.syscall = { state: "inside-syscall", number: 64, name: "write" };
  const result = translateNativeRegisterState({
    sourceArch: "arm64",
    targetArch: "amd64",
    threads: [safeThread, unsafeThread],
    continuations: {
      "thread:safe": {
        sourcePc: "0x400120",
        targetIp: "0x14000120",
        targetSp: "0x7fffffffe000",
        targetTls: "0x7ffff7d00000",
      },
    },
  });
  const translated = result.threads.filter((entry) => entry.state === "translated").length;
  const refused = result.threads.filter((entry) => entry.state === "refused").length;
  if (translated !== 1 || refused !== 1) {
    throw new Error(
      "native register translation proof did not produce one translated and one refused thread",
    );
  }
  if (result.threads[1]?.refusal?.code !== "active-syscall") {
    throw new Error("active syscall did not refuse with active-syscall");
  }
  return { formatVersion: 1, result, translated, refused };
}

function thread(id: string): NativeThreadState {
  const x = Array.from({ length: 31 }, (_value, index) => `0x${(index + 1).toString(16)}`);
  return {
    id,
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: "mapping:stack",
    sourceRegisters: { arch: "arm64", pc: "0x400120", sp: "0x7fff0000", pstate: "0x0", x },
    syscall: { state: "outside-syscall" },
    signal: { blocked: [], pending: [], activeFrame: false, altStack: { state: "disabled" } },
    tls: { threadPointer: "0xffff0000", rseq: { state: "absent" } },
  };
}

function printSummary(summary: ReturnType<typeof verifyNativeRegisterTranslation>) {
  console.log(
    `native-register-translate: translated=${summary.translated} refused=${summary.refused} refusal=${summary.result.threads[1]?.refusal?.code}`,
  );
}

main();
