import { describe, expect, it } from "vitest";

import {
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_BASE,
  buildNativeSyntheticSleepSyscallContinuation,
} from "../native-synthetic-sleep-continuation.ts";

function remainingTime(seconds = "2", nanoseconds = 500) {
  return {
    state: "modeled" as const,
    kind: "relative-duration" as const,
    source: "active-syscall-request-timespec" as const,
    precision: "requested-duration-upper-bound" as const,
    seconds,
    nanoseconds,
  };
}

describe("synthetic sleep syscall continuation", () => {
  it("generates target-native amd64 clock_nanosleep bytes with embedded timespec", () => {
    const result = buildNativeSyntheticSleepSyscallContinuation({
      threadId: "thread:1",
      remainingTime: remainingTime("2", 500),
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuation).toMatchObject({
      kind: "synthetic-sleep-syscall",
      targetArch: "amd64",
      entryAddress: NATIVE_SYNTHETIC_SLEEP_SYSCALL_BASE,
      syscall: {
        name: "clock_nanosleep",
        number: 230,
        clockId: 0,
        flags: 0,
        remainderPointer: "0x0",
      },
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    });
    expect(Buffer.from(result.continuation!.bytes.subarray(0, 22)).toString("hex")).toBe(
      "b8e600000031ff31f6488d15080000004531d20f05c3",
    );
    expect(new DataView(result.continuation!.bytes.buffer).getBigUint64(24, true)).toBe(2n);
    expect(new DataView(result.continuation!.bytes.buffer).getBigUint64(32, true)).toBe(500n);
    expect(result.continuation!.provenance).toMatchObject({
      byteSource: "generated-target-native-amd64-syscall-sequence",
      byteEncoding: "amd64-machine-code",
      generatedTargetBytes: true,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      syscallAbi: "linux-amd64",
      syscall: {
        name: "clock_nanosleep",
        number: 230,
        arguments: [
          { register: "rax", role: "syscall-number", value: "230" },
          { register: "rdi", role: "clock-id", value: "0" },
          { register: "rsi", role: "flags", value: "0" },
          { register: "rdx", role: "request-timespec-pointer" },
          { register: "r10", role: "remainder-pointer", value: "0x0" },
        ],
      },
      embeddedData: {
        kind: "timespec",
        offset: 24,
        seconds: "2",
        nanoseconds: 500,
        byteOrder: "little-endian",
        pointerRegister: "rdx",
      },
      stackSetup: {
        entryStackPointer: "target-caller-frame-stack-pointer",
        stackBytesWrittenByContinuation: 0,
        returnAddress: "trampoline-sentinel-return-address",
        requiresSourceStackBytes: false,
      },
    });
    expect(result.continuation!.provenance.bytesHex).toBe(
      Buffer.from(result.continuation!.bytes).toString("hex"),
    );
    expect(result.continuation!.provenance.byteSha256).toHaveLength(64);
  });

  it("can generate an exit-process continuation after a successful sleep syscall", () => {
    const result = buildNativeSyntheticSleepSyscallContinuation({
      threadId: "thread:1",
      remainingTime: remainingTime("0", 0),
      completionMode: "exit-process",
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuation).toMatchObject({
      completionMode: "exit-process",
      exitStatusOnSuccess: 0,
      sizeBytes: 64,
    });
    expect(Buffer.from(result.continuation!.bytes.subarray(0, 24)).toString("hex")).toBe(
      "b8e600000031ff31f6488d15200000004531d20f054885c0",
    );
    expect(Buffer.from(result.continuation!.bytes.subarray(24, 47)).toString("hex")).toBe(
      "7509b83c00000031ff0f05b83c000000bf6f0000000f05",
    );
    expect(new DataView(result.continuation!.bytes.buffer).getBigUint64(48, true)).toBe(0n);
    expect(result.continuation!.provenance.completion).toEqual({
      mode: "exit-process",
      successExitStatus: 0,
      failureExitStatus: 111,
    });
  });

  it("refuses durations outside amd64 timespec bounds", () => {
    const result = buildNativeSyntheticSleepSyscallContinuation({
      threadId: "thread:1",
      remainingTime: remainingTime("9223372036854775808", 0),
    });

    expect(result.continuation).toBeUndefined();
    expect(result.refusals[0]).toMatchObject({
      code: "target-sleep-syscall-continuation-missing",
    });
  });
});
