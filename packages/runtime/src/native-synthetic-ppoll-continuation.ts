/** Synthetic target-native ppoll timeout syscall continuation generation. */

import type { NativeModeledPpollTimeoutRemainingTime } from "./native-active-syscall-policy.ts";
import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import {
  buildNativeSyntheticModeledSyscallDescriptor,
  nativeSyntheticExitProcessSuffix,
  nativeSyntheticSyscallTimespecProvenance,
  writeNativeSyntheticRipRelativeTimespec,
  type NativeSyntheticContinuationCompletionDescriptor,
  type NativeSyntheticContinuationFailureExitBucket,
  type NativeSyntheticContinuationProvenanceSource,
  type NativeSyntheticContinuationRegisterSetupDescriptor,
  type NativeSyntheticContinuationStackSetupDescriptor,
  type NativeSyntheticSyscallArgumentDescriptor,
  type NativeSyntheticSyscallContinuationDescriptor,
} from "./native-synthetic-continuation.ts";

export const NATIVE_SYNTHETIC_PPOLL_SYSCALL_BUILD_ID = "machinen-synthetic-ppoll-syscall-v1";
export const NATIVE_SYNTHETIC_PPOLL_SYSCALL_LOGICAL_NAME = "machinen-synthetic-ppoll-syscall";
export const NATIVE_SYNTHETIC_PPOLL_SYSCALL_PATH = "machinen.synthetic://ppoll-syscall";
export const NATIVE_SYNTHETIC_PPOLL_SYSCALL_BASE = "0x700300000000";

export type NativeSyntheticPpollCompletionMode = "return-to-trampoline" | "exit-process";

export type NativeSyntheticPpollSyscallProvenanceSource =
  NativeSyntheticContinuationProvenanceSource;

export interface NativeSyntheticPpollSyscallArgumentProvenance extends NativeSyntheticSyscallArgumentDescriptor {
  register: "rax" | "rdi" | "rsi" | "rdx" | "r10" | "r8";
  role:
    | "syscall-number"
    | "fds-pointer"
    | "nfds"
    | "timeout-timespec-pointer"
    | "sigmask-pointer"
    | "sigset-size";
  source: NativeSyntheticPpollSyscallProvenanceSource;
}

export interface NativeSyntheticPpollSyscallRegisterSetupProvenance extends NativeSyntheticContinuationRegisterSetupDescriptor {
  arguments: NativeSyntheticPpollSyscallArgumentProvenance[];
  clobberedBySyscall: ["rax", "rcx", "r11"];
}

export interface NativeSyntheticPpollSyscallStackSetupProvenance extends NativeSyntheticContinuationStackSetupDescriptor {
  entryStackPointer: "target-caller-frame-stack-pointer";
  stackBytesWrittenByContinuation: 0;
  returnAddress: "trampoline-sentinel-return-address" | "not-used-exit-process-completion";
  requiresSourceStackBytes: false;
}

export interface NativeSyntheticPpollSyscallCompletionProvenance extends NativeSyntheticContinuationCompletionDescriptor {
  mode: NativeSyntheticPpollCompletionMode;
  successExitStatus?: 0;
  failureExitBuckets?: NativeSyntheticContinuationFailureExitBucket[];
}

export interface NativeSyntheticPpollSyscallContinuationProvenance extends NativeSyntheticSyscallContinuationDescriptor {
  generatorBuildId: typeof NATIVE_SYNTHETIC_PPOLL_SYSCALL_BUILD_ID;
  syscall: NativeSyntheticSyscallContinuationDescriptor["syscall"] & {
    name: "ppoll";
    number: 271;
    arguments: NativeSyntheticPpollSyscallArgumentProvenance[];
  };
  embeddedData: {
    kind: "timespec";
    offset: number;
    seconds: string;
    nanoseconds: number;
    byteOrder: "little-endian";
    pointerRegister: "rdx";
    pointerEncoding: "rip-relative";
  };
  registerSetup: NativeSyntheticPpollSyscallRegisterSetupProvenance;
  stackSetup: NativeSyntheticPpollSyscallStackSetupProvenance;
  completion: NativeSyntheticPpollSyscallCompletionProvenance;
}

export interface NativeSyntheticPpollSyscallContinuationRequest {
  threadId: string;
  remainingTime: NativeModeledPpollTimeoutRemainingTime;
  targetAddress?: string;
  completionMode?: NativeSyntheticPpollCompletionMode;
}

export interface NativeSyntheticPpollSyscallContinuation {
  kind: "synthetic-ppoll-syscall";
  threadId: string;
  targetArch: "amd64";
  entryAddress: string;
  relativeAddress: "0x0";
  syscall: {
    name: "ppoll";
    number: 271;
    fdsPointer: "0x0";
    nfds: 0;
    timeoutPointerEncoding: "rip-relative-timespec";
    sigmaskPointer: "0x0";
    sigsetSize: 0;
  };
  remainingTime: NativeModeledPpollTimeoutRemainingTime;
  completionMode: NativeSyntheticPpollCompletionMode;
  exitStatusOnSuccess?: 0;
  descriptor: NativeSyntheticSyscallContinuationDescriptor;
  provenance: NativeSyntheticPpollSyscallContinuationProvenance;
  timespecOffset: number;
  sizeBytes: number;
  bytes: Uint8Array;
  sourceTextReusedAsTargetCode: false;
  sourceIsaEmulationUsed: false;
  sidecarRuntimeUsed: false;
}

export interface NativeSyntheticPpollSyscallContinuationResult {
  continuation?: NativeSyntheticPpollSyscallContinuation;
  refusals: NativeProcessImageRefusal[];
}

const PPOLL_SYSCALL_AMD64 = 271;
const RETURNING_PPOLL_TIMESPEC_OFFSET = 32;
const RETURNING_PPOLL_CODE_SIZE = 48;
const EXITING_PPOLL_TIMESPEC_OFFSET = 112;
const EXITING_PPOLL_CODE_SIZE = 128;
const MAX_SIGNED_I64 = 0x7fff_ffff_ffff_ffffn;
const MAX_NANOSECONDS = 999_999_999;

export function buildNativeSyntheticPpollSyscallContinuation(
  request: NativeSyntheticPpollSyscallContinuationRequest,
): NativeSyntheticPpollSyscallContinuationResult {
  const validation = validateRemainingTime(request);
  if (validation) {
    return { refusals: [validation] };
  }
  const completionMode = request.completionMode ?? "return-to-trampoline";
  const bytes = syntheticPpollBytes(request.remainingTime, completionMode);
  const timespecOffset = ppollTimespecOffset(completionMode);
  const entryAddress = request.targetAddress ?? NATIVE_SYNTHETIC_PPOLL_SYSCALL_BASE;
  const descriptor = syntheticPpollDescriptor(bytes, entryAddress, completionMode);
  return {
    continuation: {
      kind: "synthetic-ppoll-syscall",
      threadId: request.threadId,
      targetArch: "amd64",
      entryAddress,
      relativeAddress: "0x0",
      syscall: {
        name: "ppoll",
        number: PPOLL_SYSCALL_AMD64,
        fdsPointer: "0x0",
        nfds: 0,
        timeoutPointerEncoding: "rip-relative-timespec",
        sigmaskPointer: "0x0",
        sigsetSize: 0,
      },
      remainingTime: request.remainingTime,
      completionMode,
      exitStatusOnSuccess: completionMode === "exit-process" ? 0 : undefined,
      descriptor,
      provenance: syntheticPpollProvenance(descriptor, request.remainingTime, timespecOffset),
      timespecOffset,
      sizeBytes: bytes.byteLength,
      bytes,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    },
    refusals: [],
  };
}

function validateRemainingTime(
  request: NativeSyntheticPpollSyscallContinuationRequest,
): NativeProcessImageRefusal | undefined {
  const seconds = BigInt(request.remainingTime.seconds);
  if (seconds > MAX_SIGNED_I64 || request.remainingTime.nanoseconds > MAX_NANOSECONDS) {
    return {
      code: "target-ppoll-syscall-continuation-missing",
      message: `thread ${request.threadId} modeled ppoll timeout is outside amd64 timespec bounds`,
      detail: { remainingTime: request.remainingTime },
    };
  }
  return undefined;
}

function syntheticPpollBytes(
  remainingTime: NativeModeledPpollTimeoutRemainingTime,
  completionMode: NativeSyntheticPpollCompletionMode,
): Uint8Array {
  const bytes = new Uint8Array(ppollCodeSize(completionMode));
  bytes.set(
    [
      0xb8,
      0x0f,
      0x01,
      0x00,
      0x00, // mov eax, 271 (ppoll)
      0x31,
      0xff, // xor edi, edi (NULL fds)
      0x31,
      0xf6, // xor esi, esi (nfds = 0)
      0x48,
      0x8d,
      0x15, // lea rdx, [rip + timespec]
      0x00,
      0x00,
      0x00,
      0x00,
      0x45,
      0x31,
      0xd2, // xor r10d, r10d (NULL sigmask)
      0x45,
      0x31,
      0xc0, // xor r8d, r8d (sigsetsize = 0)
      0x0f,
      0x05, // syscall
      0xc3, // ret to trampoline sentinel
      0x90,
      0x90,
      0x90,
      0x90,
      0x90,
      0x90,
      0x90, // align embedded timespec to 8 bytes
    ],
    0,
  );
  if (completionMode === "exit-process") {
    const suffixOffset = 24;
    const suffix = nativeSyntheticExitProcessSuffix();
    bytes.set(suffix, suffixOffset);
    bytes.fill(0x90, suffixOffset + suffix.length, ppollTimespecOffset(completionMode));
  }
  const timespecOffset = ppollTimespecOffset(completionMode);
  writeNativeSyntheticRipRelativeTimespec(bytes, timespecOffset, remainingTime);
  return bytes;
}

function syntheticPpollDescriptor(
  bytes: Uint8Array,
  entryAddress: string,
  completionMode: NativeSyntheticPpollCompletionMode,
): NativeSyntheticSyscallContinuationDescriptor {
  return buildNativeSyntheticModeledSyscallDescriptor({
    entryAddress,
    generatorBuildId: NATIVE_SYNTHETIC_PPOLL_SYSCALL_BUILD_ID,
    bytes,
    syscallName: "ppoll",
    syscallNumber: PPOLL_SYSCALL_AMD64,
    argumentsProvenance: syscallArgumentsProvenance(),
    registerSetupNotes: [
      "rax carries syscall 271 before ppoll",
      "rdi/rsi are zeroed for a NULL fd array with nfds=0",
      "rdx points at the embedded modeled timeout using RIP-relative addressing",
      "r10 is zeroed for a NULL signal mask",
      "r8 is zeroed for sigsetsize=0",
    ],
    completionMode,
  });
}

function syntheticPpollProvenance(
  descriptor: NativeSyntheticSyscallContinuationDescriptor,
  remainingTime: NativeModeledPpollTimeoutRemainingTime,
  timespecOffset: number,
): NativeSyntheticPpollSyscallContinuationProvenance {
  return nativeSyntheticSyscallTimespecProvenance(
    descriptor,
    remainingTime,
    timespecOffset,
  ) as NativeSyntheticPpollSyscallContinuationProvenance;
}

function syscallArgumentsProvenance(): NativeSyntheticPpollSyscallArgumentProvenance[] {
  return [
    {
      register: "rax",
      role: "syscall-number",
      value: String(PPOLL_SYSCALL_AMD64),
      source: "linux-amd64-syscall-abi",
    },
    { register: "rdi", role: "fds-pointer", value: "0x0", source: "linux-amd64-syscall-abi" },
    { register: "rsi", role: "nfds", value: "0", source: "linux-amd64-syscall-abi" },
    {
      register: "rdx",
      role: "timeout-timespec-pointer",
      value: "rip-relative-timespec",
      source: "modeled-source-ppoll-timeout",
    },
    { register: "r10", role: "sigmask-pointer", value: "0x0", source: "linux-amd64-syscall-abi" },
    { register: "r8", role: "sigset-size", value: "0", source: "linux-amd64-syscall-abi" },
  ];
}

function ppollTimespecOffset(completionMode: NativeSyntheticPpollCompletionMode): number {
  return completionMode === "exit-process"
    ? EXITING_PPOLL_TIMESPEC_OFFSET
    : RETURNING_PPOLL_TIMESPEC_OFFSET;
}

function ppollCodeSize(completionMode: NativeSyntheticPpollCompletionMode): number {
  return completionMode === "exit-process" ? EXITING_PPOLL_CODE_SIZE : RETURNING_PPOLL_CODE_SIZE;
}
