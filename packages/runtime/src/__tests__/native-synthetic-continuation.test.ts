import { describe, expect, it } from "vitest";

import {
  buildNativeSyntheticSyscallContinuationDescriptor,
  buildNativeSyntheticTimespecSyscallBytes,
  nativeSyntheticAmd64LeaRdxRipRelativePlaceholder,
  nativeSyntheticAmd64SyscallPrefix,
  nativeSyntheticAmd64ZeroRegister32,
  nativeSyntheticContinuationBytesHex,
  nativeSyntheticContinuationBytesSha256,
  nativeSyntheticContinuationDescriptorSha256,
  nativeSyntheticTimespecBoundsRefusal,
} from "../native-synthetic-continuation.ts";

const args = [
  {
    register: "rax" as const,
    role: "syscall-number",
    value: "39",
    source: "linux-amd64-syscall-abi" as const,
  },
];

describe("native synthetic continuation descriptor", () => {
  it("builds shared amd64 syscall prefixes and timespec byte layouts", () => {
    expect(
      Buffer.from(
        nativeSyntheticAmd64SyscallPrefix({
          syscallNumber: 271,
          argumentSetup: [
            nativeSyntheticAmd64ZeroRegister32("rdi"),
            nativeSyntheticAmd64ZeroRegister32("rsi"),
            nativeSyntheticAmd64LeaRdxRipRelativePlaceholder(),
            nativeSyntheticAmd64ZeroRegister32("r10"),
            nativeSyntheticAmd64ZeroRegister32("r8"),
          ],
        }),
      ).toString("hex"),
    ).toBe("b80f01000031ff31f6488d15000000004531d24531c00f05");

    const returning = buildNativeSyntheticTimespecSyscallBytes({
      syscallNumber: 230,
      argumentSetup: [
        nativeSyntheticAmd64ZeroRegister32("rdi"),
        nativeSyntheticAmd64ZeroRegister32("rsi"),
        nativeSyntheticAmd64LeaRdxRipRelativePlaceholder(),
        nativeSyntheticAmd64ZeroRegister32("r10"),
      ],
      completionMode: "return-to-trampoline",
      returningTimespecOffset: 24,
      returningCodeSize: 40,
      exitingTimespecOffset: 104,
      exitingCodeSize: 120,
      remainingTime: { seconds: "2", nanoseconds: 500 },
    });

    expect(Buffer.from(returning.subarray(0, 24)).toString("hex")).toBe(
      "b8e600000031ff31f6488d15080000004531d20f05c39090",
    );
    expect(new DataView(returning.buffer).getBigUint64(24, true)).toBe(2n);

    const exiting = buildNativeSyntheticTimespecSyscallBytes({
      syscallNumber: 271,
      argumentSetup: [
        nativeSyntheticAmd64ZeroRegister32("rdi"),
        nativeSyntheticAmd64ZeroRegister32("rsi"),
        nativeSyntheticAmd64LeaRdxRipRelativePlaceholder(),
        nativeSyntheticAmd64ZeroRegister32("r10"),
        nativeSyntheticAmd64ZeroRegister32("r8"),
      ],
      completionMode: "exit-process",
      returningTimespecOffset: 32,
      returningCodeSize: 48,
      exitingTimespecOffset: 128,
      exitingCodeSize: 144,
      remainingTime: { seconds: "0", nanoseconds: 0 },
    });

    expect(Buffer.from(exiting.subarray(0, 24)).toString("hex")).toBe(
      "b80f01000031ff31f6488d15700000004531d24531c00f05",
    );
    expect(Buffer.from(exiting.subarray(123, 128)).toString("hex")).toBe("9090909090");
    expect(new DataView(exiting.buffer).getBigUint64(128, true)).toBe(0n);
  });

  it("shares amd64 timespec bounds refusals", () => {
    expect(
      nativeSyntheticTimespecBoundsRefusal({
        threadId: "thread:1",
        remainingTime: { seconds: "1", nanoseconds: 0 },
        refusalCode: "target-sleep-syscall-continuation-missing",
        message: "ok",
      }),
    ).toBeUndefined();
    expect(
      nativeSyntheticTimespecBoundsRefusal({
        threadId: "thread:1",
        remainingTime: { seconds: "9223372036854775808", nanoseconds: 0 },
        refusalCode: "target-sleep-syscall-continuation-missing",
        message: "too large",
      }),
    ).toMatchObject({
      code: "target-sleep-syscall-continuation-missing",
      detail: { remainingTime: { seconds: "9223372036854775808" } },
    });
  });

  it("describes generated amd64 syscall bytes, ABI setup, and completion policy", () => {
    const bytes = new Uint8Array([0xb8, 0x27, 0x00, 0x00, 0x00, 0x0f, 0x05]);
    const descriptor = buildNativeSyntheticSyscallContinuationDescriptor({
      targetArch: "amd64",
      entryAddress: "0x700200000000",
      relativeAddress: "0x0",
      generatorBuildId: "test-synthetic-getpid",
      bytes,
      syscall: {
        name: "getpid",
        number: 39,
        arguments: args,
      },
      registerSetup: {
        abi: "linux-amd64-syscall",
        arguments: args,
        clobberedBySyscall: ["rax", "rcx", "r11"],
        notes: ["rax carries syscall 39 before getpid"],
      },
      stackSetup: {
        entryStackPointer: "target-caller-frame-stack-pointer",
        stackBytesWrittenByContinuation: 0,
        returnAddress: "trampoline-sentinel-return-address",
        requiresSourceStackBytes: false,
      },
      completion: {
        mode: "return-to-trampoline",
        failureExitBuckets: [
          {
            exitStatus: 112,
            failureKind: "syscall-return-unmodeled",
            failureReason: "getpid failure is only a descriptor test",
            syscallReturn: { register: "rax", condition: "nonzero-return" },
          },
        ],
      },
    });

    expect(descriptor).toMatchObject({
      kind: "synthetic-syscall-continuation",
      targetArch: "amd64",
      entryAddress: "0x700200000000",
      relativeAddress: "0x0",
      byteSource: "generated-target-native-amd64-syscall-sequence",
      byteEncoding: "amd64-machine-code",
      sizeBytes: 7,
      bytesHex: "b8270000000f05",
      generatedTargetBytes: true,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      syscallAbi: "linux-amd64",
      syscall: { abi: "linux-amd64", name: "getpid", number: 39, arguments: args },
      registerSetup: { abi: "linux-amd64-syscall", arguments: args },
      stackSetup: { requiresSourceStackBytes: false },
      completion: {
        mode: "return-to-trampoline",
        failureExitBuckets: [
          {
            exitStatus: 112,
            failureKind: "syscall-return-unmodeled",
            syscallReturn: { register: "rax", condition: "nonzero-return" },
          },
        ],
      },
    });
    const { descriptorSha256, ...descriptorPayload } = descriptor;
    expect(descriptor.byteSha256).toBe(nativeSyntheticContinuationBytesSha256(bytes));
    expect(descriptorSha256).toHaveLength(64);
    expect(descriptorSha256).toBe(nativeSyntheticContinuationDescriptorSha256(descriptorPayload));
    expect(nativeSyntheticContinuationBytesHex(bytes)).toBe("b8270000000f05");
  });
});
