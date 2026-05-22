import { describe, expect, it } from "vitest";

import {
  NATIVE_SYNTHETIC_PPOLL_SYSCALL_BASE,
  buildNativeSyntheticPpollSyscallContinuation,
} from "../native-synthetic-ppoll-continuation.ts";

function remainingTime(seconds = "1", nanoseconds = 250) {
  return {
    state: "modeled" as const,
    kind: "relative-duration" as const,
    source: "active-syscall-ppoll-timeout" as const,
    precision: "requested-duration-upper-bound" as const,
    seconds,
    nanoseconds,
  };
}

describe("synthetic ppoll syscall continuation", () => {
  it("generates target-native amd64 ppoll bytes with an embedded timeout", () => {
    const result = buildNativeSyntheticPpollSyscallContinuation({
      threadId: "thread:1",
      remainingTime: remainingTime("1", 250),
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuation).toMatchObject({
      kind: "synthetic-ppoll-syscall",
      targetArch: "amd64",
      entryAddress: NATIVE_SYNTHETIC_PPOLL_SYSCALL_BASE,
      syscall: {
        name: "ppoll",
        number: 271,
        fdsPointer: "0x0",
        nfds: 0,
        sigmaskPointer: "0x0",
      },
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    });
    expect(Buffer.from(result.continuation!.bytes.subarray(0, 25)).toString("hex")).toBe(
      "b80f01000031ff31f6488d15100000004531d24531c00f05c3",
    );
    expect(new DataView(result.continuation!.bytes.buffer).getBigUint64(32, true)).toBe(1n);
    expect(new DataView(result.continuation!.bytes.buffer).getBigUint64(40, true)).toBe(250n);
    expect(result.continuation!.descriptor).toMatchObject({
      kind: "synthetic-syscall-continuation",
      targetArch: "amd64",
      entryAddress: NATIVE_SYNTHETIC_PPOLL_SYSCALL_BASE,
      byteSource: "generated-target-native-amd64-syscall-sequence",
      syscall: { abi: "linux-amd64", name: "ppoll", number: 271 },
      registerSetup: { abi: "linux-amd64-syscall" },
      stackSetup: { requiresSourceStackBytes: false },
      completion: { mode: "return-to-trampoline" },
    });
    expect(result.continuation!.provenance).toMatchObject({
      byteEncoding: "amd64-machine-code",
      generatedTargetBytes: true,
      syscallAbi: "linux-amd64",
      syscall: {
        name: "ppoll",
        number: 271,
        arguments: [
          { register: "rax", role: "syscall-number", value: "271" },
          { register: "rdi", role: "fds-pointer", value: "0x0" },
          { register: "rsi", role: "nfds", value: "0" },
          { register: "rdx", role: "timeout-timespec-pointer" },
          { register: "r10", role: "sigmask-pointer", value: "0x0" },
          { register: "r8", role: "sigset-size", value: "0" },
        ],
      },
      embeddedData: {
        kind: "timespec",
        offset: 32,
        seconds: "1",
        nanoseconds: 250,
        pointerRegister: "rdx",
      },
    });
    expect(result.continuation!.descriptor.descriptorSha256).toHaveLength(64);
  });

  it("can generate an exit-process continuation after a successful ppoll timeout", () => {
    const result = buildNativeSyntheticPpollSyscallContinuation({
      threadId: "thread:1",
      remainingTime: remainingTime("0", 0),
      completionMode: "exit-process",
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuation).toMatchObject({
      completionMode: "exit-process",
      exitStatusOnSuccess: 0,
      sizeBytes: 128,
    });
    expect(Buffer.from(result.continuation!.bytes.subarray(0, 24)).toString("hex")).toBe(
      "b80f01000031ff31f6488d15600000004531d24531c00f05",
    );
    expect(new DataView(result.continuation!.bytes.buffer).getBigUint64(112, true)).toBe(0n);
    expect(result.continuation!.descriptor.completion).toMatchObject({
      mode: "exit-process",
      successExitStatus: 0,
      failureExitBuckets: [
        {
          exitStatus: 111,
          failureKind: "signal-restart-unsupported",
          syscallReturn: { condition: "restart-like-negative-errno" },
        },
        {
          exitStatus: 112,
          failureKind: "syscall-return-unmodeled",
          syscallReturn: { condition: "other-negative-errno" },
        },
      ],
    });
  });

  it("refuses durations outside amd64 timespec bounds", () => {
    const result = buildNativeSyntheticPpollSyscallContinuation({
      threadId: "thread:1",
      remainingTime: remainingTime("9223372036854775808", 0),
    });

    expect(result.continuation).toBeUndefined();
    expect(result.refusals[0]).toMatchObject({
      code: "target-ppoll-syscall-continuation-missing",
    });
  });
});
