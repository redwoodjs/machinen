/** Shared descriptors for generated target-native synthetic continuations. */

import { createHash } from "node:crypto";

import type {
  NativeProcessImageRefusal,
  NativeProcessImageRefusalCode,
} from "./native-process-image.ts";

export const NATIVE_SYNTHETIC_SYSCALL_RESTART_EXIT_STATUS = 111;
export const NATIVE_SYNTHETIC_SYSCALL_UNMODELED_RETURN_EXIT_STATUS = 112;

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
  | "modeled-source-ppoll-timeout"
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

interface NativeSyntheticTimespecDuration {
  seconds: string;
  nanoseconds: number;
}

interface NativeSyntheticTimespecEmbeddedDataDescriptor {
  kind: "timespec";
  offset: number;
  seconds: string;
  nanoseconds: number;
  byteOrder: "little-endian";
  pointerRegister: "rdx";
  pointerEncoding: "rip-relative";
}

interface NativeSyntheticTimespecSyscallBytecodeRequest {
  syscallNumber: number;
  argumentSetup: number[][];
  completionMode: string;
  returningTimespecOffset: number;
  returningCodeSize: number;
  exitingTimespecOffset: number;
  exitingCodeSize: number;
  remainingTime: NativeSyntheticTimespecDuration;
}

interface NativeSyntheticTimespecBoundsRefusalRequest {
  threadId: string;
  remainingTime: NativeSyntheticTimespecDuration;
  refusalCode: NativeProcessImageRefusalCode;
  message: string;
  detail?: Record<string, unknown>;
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

export function buildNativeSyntheticModeledSyscallDescriptor(request: {
  entryAddress: string;
  generatorBuildId: string;
  bytes: Uint8Array;
  syscallName: string;
  syscallNumber: number;
  argumentsProvenance: NativeSyntheticSyscallArgumentDescriptor[];
  registerSetupNotes: string[];
  completionMode: string;
  completionOverrides?: Partial<NativeSyntheticContinuationCompletionDescriptor>;
}): NativeSyntheticSyscallContinuationDescriptor {
  return buildNativeSyntheticSyscallContinuationDescriptor({
    targetArch: "amd64",
    entryAddress: request.entryAddress,
    relativeAddress: "0x0",
    generatorBuildId: request.generatorBuildId,
    bytes: request.bytes,
    syscall: {
      name: request.syscallName,
      number: request.syscallNumber,
      arguments: request.argumentsProvenance,
    },
    registerSetup: nativeSyntheticSyscallRegisterSetup(
      request.argumentsProvenance,
      request.registerSetupNotes,
    ),
    stackSetup: nativeSyntheticSyscallStackSetup(request.completionMode),
    completion: {
      ...nativeSyntheticSyscallCompletion(request.completionMode, request.syscallName),
      ...request.completionOverrides,
    },
  });
}

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

export function buildNativeSyntheticTimespecSyscallBytes(
  request: NativeSyntheticTimespecSyscallBytecodeRequest,
): Uint8Array {
  const timespecOffset = nativeSyntheticTimespecOffset(request);
  const bytes = new Uint8Array(
    request.completionMode === "exit-process" ? request.exitingCodeSize : request.returningCodeSize,
  );
  const prefix = nativeSyntheticAmd64SyscallPrefix({
    syscallNumber: request.syscallNumber,
    argumentSetup: request.argumentSetup,
  });
  bytes.set(prefix, 0);
  if (request.completionMode === "exit-process") {
    const suffix = nativeSyntheticExitProcessSuffix();
    bytes.set(suffix, prefix.length);
    bytes.fill(0x90, prefix.length + suffix.length, timespecOffset);
  } else {
    bytes.set([0xc3], prefix.length);
    bytes.fill(0x90, prefix.length + 1, timespecOffset);
  }
  writeNativeSyntheticRipRelativeTimespec(bytes, timespecOffset, request.remainingTime);
  return bytes;
}

export function nativeSyntheticTimespecOffset(
  request: Pick<
    NativeSyntheticTimespecSyscallBytecodeRequest,
    "completionMode" | "returningTimespecOffset" | "exitingTimespecOffset"
  >,
): number {
  return request.completionMode === "exit-process"
    ? request.exitingTimespecOffset
    : request.returningTimespecOffset;
}

export function nativeSyntheticAmd64SyscallPrefix(request: {
  syscallNumber: number;
  argumentSetup: number[][];
}): number[] {
  return [
    ...nativeSyntheticAmd64MovEaxImmediate32(request.syscallNumber),
    ...request.argumentSetup.flat(),
    ...nativeSyntheticAmd64SyscallInstruction(),
  ];
}

function nativeSyntheticAmd64MovEaxImmediate32(value: number): number[] {
  return [0xb8, value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

export function nativeSyntheticAmd64ZeroRegister32(
  register: "rdi" | "rsi" | "r10" | "r8",
): number[] {
  switch (register) {
    case "rdi":
      return [0x31, 0xff];
    case "rsi":
      return [0x31, 0xf6];
    case "r10":
      return [0x45, 0x31, 0xd2];
    case "r8":
      return [0x45, 0x31, 0xc0];
  }
}

export function nativeSyntheticAmd64LeaRdxRipRelativePlaceholder(): number[] {
  return [0x48, 0x8d, 0x15, 0x00, 0x00, 0x00, 0x00];
}

function nativeSyntheticAmd64SyscallInstruction(): number[] {
  return [0x0f, 0x05];
}

export function nativeSyntheticTimespecBoundsRefusal(
  request: NativeSyntheticTimespecBoundsRefusalRequest,
): NativeProcessImageRefusal | undefined {
  const seconds = BigInt(request.remainingTime.seconds);
  if (seconds <= 0x7fff_ffff_ffff_ffffn && request.remainingTime.nanoseconds <= 999_999_999) {
    return undefined;
  }
  return {
    code: request.refusalCode,
    message: request.message,
    detail: { remainingTime: request.remainingTime, ...request.detail },
  };
}

export function nativeSyntheticRestartLikeErrnos(): { errno: number; errnoName: string }[] {
  return [
    { errno: 4, errnoName: "EINTR" },
    { errno: 512, errnoName: "ERESTARTSYS" },
    { errno: 513, errnoName: "ERESTARTNOINTR" },
    { errno: 514, errnoName: "ERESTARTNOHAND" },
    { errno: 516, errnoName: "ERESTART_RESTARTBLOCK" },
  ];
}

export function nativeSyntheticSyscallFailureExitBuckets(
  syscallName: string,
): NativeSyntheticContinuationFailureExitBucket[] {
  return [
    {
      exitStatus: NATIVE_SYNTHETIC_SYSCALL_RESTART_EXIT_STATUS,
      failureKind: "signal-restart-unsupported",
      failureReason: `${syscallName} returned EINTR or a restart-like errno; signal restart handling is not modeled`,
      syscallReturn: {
        register: "rax",
        condition: "restart-like-negative-errno",
        errnos: nativeSyntheticRestartLikeErrnos(),
      },
    },
    {
      exitStatus: NATIVE_SYNTHETIC_SYSCALL_UNMODELED_RETURN_EXIT_STATUS,
      failureKind: "syscall-return-unmodeled",
      failureReason: `${syscallName} returned another non-success value; errno-specific recovery is not modeled`,
      syscallReturn: {
        register: "rax",
        condition: "other-negative-errno",
        errnoRange: { min: 1, max: 4095 },
        excludedErrnos: nativeSyntheticRestartLikeErrnos(),
      },
    },
  ];
}

function nativeSyntheticSyscallRegisterSetup(
  argumentsProvenance: NativeSyntheticSyscallArgumentDescriptor[],
  notes: string[],
): NativeSyntheticContinuationRegisterSetupDescriptor {
  return {
    abi: "linux-amd64-syscall",
    arguments: argumentsProvenance,
    clobberedBySyscall: ["rax", "rcx", "r11"],
    notes,
  };
}

function nativeSyntheticSyscallStackSetup(
  completionMode: string,
): NativeSyntheticContinuationStackSetupDescriptor {
  return {
    entryStackPointer: "target-caller-frame-stack-pointer",
    stackBytesWrittenByContinuation: 0,
    returnAddress:
      completionMode === "exit-process"
        ? "not-used-exit-process-completion"
        : "trampoline-sentinel-return-address",
    requiresSourceStackBytes: false,
  };
}

function nativeSyntheticSyscallCompletion(
  completionMode: string,
  syscallName: string,
): NativeSyntheticContinuationCompletionDescriptor {
  return {
    mode: completionMode,
    successExitStatus: completionMode === "exit-process" ? 0 : undefined,
    failureExitBuckets:
      completionMode === "exit-process"
        ? nativeSyntheticSyscallFailureExitBuckets(syscallName)
        : undefined,
  };
}

function nativeSyntheticTimespecEmbeddedData(
  offset: number,
  remainingTime: { seconds: string; nanoseconds: number },
): NativeSyntheticTimespecEmbeddedDataDescriptor {
  return {
    kind: "timespec",
    offset,
    seconds: remainingTime.seconds,
    nanoseconds: remainingTime.nanoseconds,
    byteOrder: "little-endian",
    pointerRegister: "rdx",
    pointerEncoding: "rip-relative",
  };
}

export function nativeSyntheticSyscallTimespecProvenance(
  descriptor: NativeSyntheticSyscallContinuationDescriptor,
  remainingTime: { seconds: string; nanoseconds: number },
  timespecOffset: number,
): NativeSyntheticSyscallContinuationDescriptor & {
  embeddedData: NativeSyntheticTimespecEmbeddedDataDescriptor;
} {
  return {
    ...descriptor,
    embeddedData: nativeSyntheticTimespecEmbeddedData(timespecOffset, remainingTime),
  };
}

function writeNativeSyntheticRipRelativeTimespec(
  bytes: Uint8Array,
  timespecOffset: number,
  remainingTime: { seconds: string; nanoseconds: number },
  options: { displacementOffset: number; ripAfterLea: number } = {
    displacementOffset: 12,
    ripAfterLea: 16,
  },
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setInt32(options.displacementOffset, timespecOffset - options.ripAfterLea, true);
  view.setBigUint64(timespecOffset, BigInt(remainingTime.seconds), true);
  view.setBigUint64(timespecOffset + 8, BigInt(remainingTime.nanoseconds), true);
}

export function nativeSyntheticExitProcessSuffix(): number[] {
  return [
    0x48,
    0x85,
    0xc0, // test rax, rax
    0x74,
    0x28, // je success exit
    0x48,
    0x83,
    0xf8,
    0xfc, // cmp rax, -EINTR
    0x74,
    0x2b, // je restart failure exit
    0x48,
    0x3d,
    0x00,
    0xfe,
    0xff,
    0xff, // cmp rax, -ERESTARTSYS
    0x74,
    0x23, // je restart failure exit
    0x48,
    0x3d,
    0xff,
    0xfd,
    0xff,
    0xff, // cmp rax, -ERESTARTNOINTR
    0x74,
    0x1b, // je restart failure exit
    0x48,
    0x3d,
    0xfe,
    0xfd,
    0xff,
    0xff, // cmp rax, -ERESTARTNOHAND
    0x74,
    0x13, // je restart failure exit
    0x48,
    0x3d,
    0xfc,
    0xfd,
    0xff,
    0xff, // cmp rax, -ERESTART_RESTARTBLOCK
    0x74,
    0x0b, // je restart failure exit
    0xeb,
    0x15, // jmp unmodeled return failure exit
    0xb8,
    0x3c,
    0x00,
    0x00,
    0x00, // mov eax, 60 (exit)
    0x31,
    0xff, // xor edi, edi (status 0)
    0x0f,
    0x05, // syscall
    0xb8,
    0x3c,
    0x00,
    0x00,
    0x00, // mov eax, 60 (exit)
    0xbf,
    NATIVE_SYNTHETIC_SYSCALL_RESTART_EXIT_STATUS,
    0x00,
    0x00,
    0x00, // mov edi, 111 (EINTR/restart failure)
    0x0f,
    0x05, // syscall
    0xb8,
    0x3c,
    0x00,
    0x00,
    0x00, // mov eax, 60 (exit)
    0xbf,
    NATIVE_SYNTHETIC_SYSCALL_UNMODELED_RETURN_EXIT_STATUS,
    0x00,
    0x00,
    0x00, // mov edi, 112 (unmodeled negative errno)
    0x0f,
    0x05, // syscall
    0x90,
    0x90,
    0x90,
    0x90,
    0x90,
  ];
}
