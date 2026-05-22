import { describe, expect, it } from "vitest";

import {
  buildNativeSyntheticSyscallContinuationDescriptor,
  nativeSyntheticContinuationBytesHex,
  nativeSyntheticContinuationBytesSha256,
  nativeSyntheticContinuationDescriptorSha256,
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
