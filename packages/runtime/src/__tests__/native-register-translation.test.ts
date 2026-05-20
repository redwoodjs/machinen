import { describe, expect, it } from "vitest";

import { translateNativeRegisterState } from "../native-register-translation.ts";
import type { NativeThreadState } from "../native-process-image.ts";

function arm64Thread(id = "thread:1"): NativeThreadState {
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

function translate(thread: NativeThreadState) {
  return translateNativeRegisterState({
    sourceArch: "arm64",
    targetArch: "amd64",
    threads: [thread],
    continuations: {
      [thread.id]: {
        sourcePc: "0x400120",
        targetIp: "0x14000120",
        targetSp: "0x7fffffffe000",
        targetTls: "0x7ffff7d00000",
      },
    },
  });
}

describe("native register translation", () => {
  it("translates safe arm64 user-space register state into amd64 target registers", () => {
    const result = translate(arm64Thread());

    expect(result.refusals).toEqual([]);
    expect(result.threads[0]).toMatchObject({
      sourceThreadId: "thread:1",
      state: "translated",
      targetRegisters: {
        arch: "amd64",
        rip: "0x14000120",
        rsp: "0x7fffffffe000",
        fsBase: "0x7ffff7d00000",
        rdi: "0x1",
        rsi: "0x2",
        rdx: "0x3",
        rcx: "0x4",
      },
    });
  });

  it("refuses active syscall states before register translation", () => {
    const thread = arm64Thread();
    thread.syscall = { state: "inside-syscall", number: 64, name: "write" };

    const result = translate(thread);

    expect(result.threads[0]).toMatchObject({
      state: "refused",
      refusal: { code: "active-syscall", message: expect.stringContaining("inside-syscall") },
    });
  });

  it("refuses signal frames and alt-stack state", () => {
    const signalFrame = arm64Thread("thread:signal");
    signalFrame.signal.activeFrame = true;
    const altStack = arm64Thread("thread:altstack");
    altStack.signal.altStack = { state: "enabled", sp: "0x7000", sizeBytes: 4096 };

    const result = translateNativeRegisterState({
      sourceArch: "arm64",
      targetArch: "amd64",
      threads: [signalFrame, altStack],
      continuations: {},
    });

    expect(result.threads.map((thread) => thread.refusal?.code)).toEqual([
      "signal-frame-active",
      "signal-state-unsupported",
    ]);
  });

  it("refuses captured rseq state", () => {
    const thread = arm64Thread();
    thread.tls.rseq = { state: "captured" };

    expect(translate(thread).threads[0]?.refusal?.code).toBe("rseq-state-unsupported");
  });

  it("refuses missing or mismatched continuation targets", () => {
    const missing = translateNativeRegisterState({
      sourceArch: "arm64",
      targetArch: "amd64",
      threads: [arm64Thread()],
      continuations: {},
    });
    const mismatched = translateNativeRegisterState({
      sourceArch: "arm64",
      targetArch: "amd64",
      threads: [arm64Thread()],
      continuations: {
        "thread:1": {
          sourcePc: "0x400124",
          targetIp: "0x14000124",
          targetSp: "0x7fffffffe000",
          targetTls: "0x7ffff7d00000",
        },
      },
    });

    expect(missing.threads[0]?.refusal?.code).toBe("code-location-unknown");
    expect(mismatched.threads[0]?.refusal?.code).toBe("code-location-unknown");
  });

  it("refuses unsupported architecture pairs for every thread", () => {
    const result = translateNativeRegisterState({
      sourceArch: "amd64",
      targetArch: "arm64",
      threads: [arm64Thread("thread:a"), arm64Thread("thread:b")],
      continuations: {},
    });

    expect(result.threads).toHaveLength(2);
    expect(
      result.threads.every((thread) => thread.refusal?.code === "architecture-pair-unsupported"),
    ).toBe(true);
  });
});
