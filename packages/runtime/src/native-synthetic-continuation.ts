/** Shared descriptors for generated target-native synthetic continuations. */

import { createHash } from "node:crypto";

export type NativeSyntheticContinuationTargetArch = "amd64";
export type NativeSyntheticContinuationByteSource =
  "generated-target-native-amd64-syscall-sequence";
export type NativeSyntheticContinuationByteEncoding = "amd64-machine-code";
export type NativeSyntheticContinuationSyscallAbi = "linux-amd64";
export type NativeSyntheticContinuationRegisterSetupAbi = "linux-amd64-syscall";
export type NativeSyntheticContinuationFailureKind =
  | "signal-restart-unsupported"
  | "syscall-return-unmodeled";
export type NativeSyntheticContinuationFailureExitBucketCondition =
  | "equals-negative-errno"
  | "restart-like-negative-errno"
  | "other-negative-errno"
  | "nonzero-return";
export type NativeSyntheticContinuationRegister =
  | "rax"
  | "rdi"
  | "rsi"
  | "rdx"
  | "r10"
  | "r8"
  | "r9"
  | "rcx"
  | "r11";

export type NativeSyntheticContinuationProvenanceSource =
  | "generated-target-native-amd64-syscall-sequence"
  | "linux-amd64-syscall-abi"
  | "modeled-source-sleep-timer"
  | "target-caller-frame";

export interface NativeSyntheticSyscallArgumentDescriptor {
  register: NativeSyntheticContinuationRegister;
  role: string;
  value: string;
  source: NativeSyntheticContinuationProvenanceSource;
}

export interface NativeSyntheticSyscallDescriptor {
  abi: NativeSyntheticContinuationSyscallAbi;
  name: string;
  number: number;
  arguments: NativeSyntheticSyscallArgumentDescriptor[];
}

export interface NativeSyntheticContinuationRegisterSetupDescriptor {
  abi: NativeSyntheticContinuationRegisterSetupAbi;
  arguments: NativeSyntheticSyscallArgumentDescriptor[];
  clobberedBySyscall: NativeSyntheticContinuationRegister[];
  notes: string[];
}

export interface NativeSyntheticContinuationStackSetupDescriptor {
  entryStackPointer: string;
  stackBytesWrittenByContinuation: number;
  returnAddress: string;
  requiresSourceStackBytes: boolean;
}

export interface NativeSyntheticContinuationFailureExitBucket {
  exitStatus: number;
  failureKind: NativeSyntheticContinuationFailureKind;
  failureReason: string;
  syscallReturn: {
    register: "rax";
    condition: NativeSyntheticContinuationFailureExitBucketCondition;
    errno?: number;
    errnoName?: string;
    errnos?: { errno: number; errnoName: string }[];
    errnoRange?: { min: number; max: number };
    excludedErrnos?: { errno: number; errnoName: string }[];
  };
}

export interface NativeSyntheticContinuationCompletionDescriptor {
  mode: string;
  successExitStatus?: number;
  /** Legacy single-bucket failure status. Prefer failureExitBuckets for new continuations. */
  failureExitStatus?: number;
  /** Legacy single-bucket failure kind. Prefer failureExitBuckets for new continuations. */
  failureKind?: NativeSyntheticContinuationFailureKind;
  /** Legacy single-bucket failure reason. Prefer failureExitBuckets for new continuations. */
  failureReason?: string;
  failureExitBuckets?: NativeSyntheticContinuationFailureExitBucket[];
}

export interface NativeSyntheticSyscallContinuationDescriptorRequest {
  targetArch: NativeSyntheticContinuationTargetArch;
  entryAddress: string;
  relativeAddress: string;
  generatorBuildId: string;
  bytes: Uint8Array;
  syscall: Omit<NativeSyntheticSyscallDescriptor, "abi">;
  registerSetup: NativeSyntheticContinuationRegisterSetupDescriptor;
  stackSetup: NativeSyntheticContinuationStackSetupDescriptor;
  completion: NativeSyntheticContinuationCompletionDescriptor;
}

export interface NativeSyntheticSyscallContinuationDescriptor {
  kind: "synthetic-syscall-continuation";
  targetArch: NativeSyntheticContinuationTargetArch;
  entryAddress: string;
  relativeAddress: string;
  byteSource: NativeSyntheticContinuationByteSource;
  generatorBuildId: string;
  byteEncoding: NativeSyntheticContinuationByteEncoding;
  sizeBytes: number;
  bytesHex: string;
  byteSha256: string;
  descriptorSha256: string;
  generatedTargetBytes: true;
  sourceTextReusedAsTargetCode: false;
  sourceIsaEmulationUsed: false;
  sidecarRuntimeUsed: false;
  syscallAbi: NativeSyntheticContinuationSyscallAbi;
  syscall: NativeSyntheticSyscallDescriptor;
  registerSetup: NativeSyntheticContinuationRegisterSetupDescriptor;
  stackSetup: NativeSyntheticContinuationStackSetupDescriptor;
  completion: NativeSyntheticContinuationCompletionDescriptor;
}

export type NativeSyntheticSyscallContinuationDescriptorPayload = Omit<
  NativeSyntheticSyscallContinuationDescriptor,
  "descriptorSha256"
>;

export function buildNativeSyntheticSyscallContinuationDescriptor(
  request: NativeSyntheticSyscallContinuationDescriptorRequest,
): NativeSyntheticSyscallContinuationDescriptor {
  const descriptor: NativeSyntheticSyscallContinuationDescriptorPayload = {
    kind: "synthetic-syscall-continuation",
    targetArch: request.targetArch,
    entryAddress: request.entryAddress,
    relativeAddress: request.relativeAddress,
    byteSource: "generated-target-native-amd64-syscall-sequence",
    generatorBuildId: request.generatorBuildId,
    byteEncoding: "amd64-machine-code",
    sizeBytes: request.bytes.byteLength,
    bytesHex: nativeSyntheticContinuationBytesHex(request.bytes),
    byteSha256: nativeSyntheticContinuationBytesSha256(request.bytes),
    generatedTargetBytes: true,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
    syscallAbi: "linux-amd64",
    syscall: {
      abi: "linux-amd64",
      ...request.syscall,
    },
    registerSetup: request.registerSetup,
    stackSetup: request.stackSetup,
    completion: request.completion,
  };
  return {
    ...descriptor,
    descriptorSha256: nativeSyntheticContinuationDescriptorSha256(descriptor),
  };
}

export function nativeSyntheticContinuationBytesHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function nativeSyntheticContinuationBytesSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function nativeSyntheticContinuationDescriptorSha256(
  descriptor: NativeSyntheticSyscallContinuationDescriptorPayload,
): string {
  return createHash("sha256").update(JSON.stringify(descriptor)).digest("hex");
}
