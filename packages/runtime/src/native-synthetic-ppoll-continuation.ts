/** Synthetic target-native ppoll timeout syscall continuation generation. */

import type {
  NativeModeledPpollFdState,
  NativeModeledPpollTimeoutRemainingTime,
  NativeModeledPpollTimeoutState,
} from "./native-active-syscall-policy.ts";
import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import {
  buildNativeSyntheticModeledSyscallDescriptor,
  buildNativeSyntheticTimespecSyscallBytes,
  nativeSyntheticAmd64LeaRdxRipRelativePlaceholder,
  nativeSyntheticAmd64ZeroRegister32,
  nativeSyntheticSyscallTimespecProvenance,
  writeNativeSyntheticCompletionBytes,
  nativeSyntheticTimespecBoundsRefusal,
  nativeSyntheticTimespecOffset,
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
  embeddedPollFds?: {
    kind: "pollfd-array";
    offset: number;
    entries: NativeModeledPpollFdState[];
    byteOrder: "little-endian";
    pointerRegister: "rdi";
    pointerEncoding: "stack-relative";
  };
  registerSetup: NativeSyntheticPpollSyscallRegisterSetupProvenance;
  stackSetup: NativeSyntheticPpollSyscallStackSetupProvenance;
  completion: NativeSyntheticPpollSyscallCompletionProvenance;
}

export interface NativeSyntheticPpollSyscallContinuationRequest {
  threadId: string;
  remainingTime: NativeModeledPpollTimeoutRemainingTime;
  ppollTimeout?: NativeModeledPpollTimeoutState;
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
    fdsPointer: "0x0" | "stack-relative-pollfd-array";
    nfds: 0 | 1;
    pollFds?: NativeModeledPpollFdState[];
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
const RETURNING_PPOLL_ONE_FD_POLLFD_STACK_OFFSET = -8;
const RETURNING_PPOLL_ONE_FD_TIMESPEC_OFFSET = 56;
const RETURNING_PPOLL_ONE_FD_CODE_SIZE = 72;
const EXITING_PPOLL_ONE_FD_POLLFD_STACK_OFFSET = -8;
const EXITING_PPOLL_ONE_FD_TIMESPEC_OFFSET = 144;
const EXITING_PPOLL_ONE_FD_CODE_SIZE = 160;

export function buildNativeSyntheticPpollSyscallContinuation(
  request: NativeSyntheticPpollSyscallContinuationRequest,
): NativeSyntheticPpollSyscallContinuationResult {
  const validation = validateRemainingTime(request);
  if (validation) {
    return { refusals: [validation] };
  }
  const completionMode = request.completionMode ?? "return-to-trampoline";
  const pollFds = request.ppollTimeout?.pollFds;
  const bytes = syntheticPpollBytes(request.remainingTime, completionMode, pollFds);
  const timespecOffset = ppollTimespecOffset(completionMode, pollFds);
  const entryAddress = request.targetAddress ?? NATIVE_SYNTHETIC_PPOLL_SYSCALL_BASE;
  const descriptor = syntheticPpollDescriptor(bytes, entryAddress, completionMode, pollFds);
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
        fdsPointer: pollFds?.length === 1 ? "stack-relative-pollfd-array" : "0x0",
        nfds: pollFds?.length === 1 ? 1 : 0,
        pollFds,
        timeoutPointerEncoding: "rip-relative-timespec",
        sigmaskPointer: "0x0",
        sigsetSize: 0,
      },
      remainingTime: request.remainingTime,
      completionMode,
      exitStatusOnSuccess: completionMode === "exit-process" ? 0 : undefined,
      descriptor,
      provenance: syntheticPpollProvenance(
        descriptor,
        request.remainingTime,
        timespecOffset,
        pollFds,
        ppollPollFdOffset(completionMode, pollFds),
      ),
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
  return nativeSyntheticTimespecBoundsRefusal({
    threadId: request.threadId,
    remainingTime: request.remainingTime,
    refusalCode: "target-ppoll-syscall-continuation-missing",
    message: `thread ${request.threadId} modeled ppoll timeout is outside amd64 timespec bounds`,
  });
}

function syntheticPpollBytes(
  remainingTime: NativeModeledPpollTimeoutRemainingTime,
  completionMode: NativeSyntheticPpollCompletionMode,
  pollFds: NativeModeledPpollFdState[] | undefined,
): Uint8Array {
  if (pollFds?.length === 1) {
    return syntheticPpollOneFdBytes(remainingTime, completionMode, pollFds[0]);
  }
  return buildNativeSyntheticTimespecSyscallBytes({
    syscallNumber: PPOLL_SYSCALL_AMD64,
    argumentSetup: [
      nativeSyntheticAmd64ZeroRegister32("rdi"),
      nativeSyntheticAmd64ZeroRegister32("rsi"),
      nativeSyntheticAmd64LeaRdxRipRelativePlaceholder(),
      nativeSyntheticAmd64ZeroRegister32("r10"),
      nativeSyntheticAmd64ZeroRegister32("r8"),
    ],
    completionMode,
    returningTimespecOffset: RETURNING_PPOLL_TIMESPEC_OFFSET,
    returningCodeSize: RETURNING_PPOLL_CODE_SIZE,
    exitingTimespecOffset: EXITING_PPOLL_TIMESPEC_OFFSET,
    exitingCodeSize: EXITING_PPOLL_CODE_SIZE,
    remainingTime,
  });
}

function syntheticPpollOneFdBytes(
  remainingTime: NativeModeledPpollTimeoutRemainingTime,
  completionMode: NativeSyntheticPpollCompletionMode,
  pollFd: NativeModeledPpollFdState,
): Uint8Array {
  const bytes = new Uint8Array(ppollCodeSize(completionMode, [pollFd]));
  const prefix = [
    0xb8,
    0x0f,
    0x01,
    0x00,
    0x00, // mov eax, 271 (ppoll)
    0xc7,
    0x44,
    0x24,
    0xf8,
    0x00,
    0x00,
    0x00,
    0x00, // mov dword ptr [rsp - 8], fd
    0x66,
    0xc7,
    0x44,
    0x24,
    0xfc,
    0x00,
    0x00, // mov word ptr [rsp - 4], events
    0x66,
    0xc7,
    0x44,
    0x24,
    0xfe,
    0x00,
    0x00, // mov word ptr [rsp - 2], revents
    0x48,
    0x8d,
    0x7c,
    0x24,
    0xf8, // lea rdi, [rsp - 8]
    0xbe,
    0x01,
    0x00,
    0x00,
    0x00, // mov esi, 1 (nfds)
    0x48,
    0x8d,
    0x15,
    0x00,
    0x00,
    0x00,
    0x00, // lea rdx, [rip + timespec]
    0x45,
    0x31,
    0xd2, // xor r10d, r10d (NULL sigmask)
    0x45,
    0x31,
    0xc0, // xor r8d, r8d (sigsetsize = 0)
    0x0f,
    0x05, // syscall
  ];
  const timespecOffset = ppollTimespecOffset(completionMode, [pollFd]);
  bytes.set(prefix, 0);
  writeNativeSyntheticCompletionBytes(bytes, prefix.length, timespecOffset, completionMode);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setInt32(9, pollFd.fd, true);
  view.setInt16(18, pollFd.events, true);
  view.setInt16(25, pollFd.revents, true);
  view.setInt32(40, timespecOffset - 44, true);
  view.setBigUint64(timespecOffset, BigInt(remainingTime.seconds), true);
  view.setBigUint64(timespecOffset + 8, BigInt(remainingTime.nanoseconds), true);
  return bytes;
}

function syntheticPpollDescriptor(
  bytes: Uint8Array,
  entryAddress: string,
  completionMode: NativeSyntheticPpollCompletionMode,
  pollFds: NativeModeledPpollFdState[] | undefined,
): NativeSyntheticSyscallContinuationDescriptor {
  return buildNativeSyntheticModeledSyscallDescriptor({
    entryAddress,
    generatorBuildId: NATIVE_SYNTHETIC_PPOLL_SYSCALL_BUILD_ID,
    bytes,
    syscallName: "ppoll",
    syscallNumber: PPOLL_SYSCALL_AMD64,
    argumentsProvenance: syscallArgumentsProvenance(pollFds),
    registerSetupNotes: registerSetupNotes(pollFds),
    completionMode,
  });
}

function syntheticPpollProvenance(
  descriptor: NativeSyntheticSyscallContinuationDescriptor,
  remainingTime: NativeModeledPpollTimeoutRemainingTime,
  timespecOffset: number,
  pollFds: NativeModeledPpollFdState[] | undefined,
  pollFdOffset: number | undefined,
): NativeSyntheticPpollSyscallContinuationProvenance {
  const provenance = nativeSyntheticSyscallTimespecProvenance(
    descriptor,
    remainingTime,
    timespecOffset,
  ) as NativeSyntheticPpollSyscallContinuationProvenance;
  return pollFds?.length === 1 && pollFdOffset !== undefined
    ? {
        ...provenance,
        embeddedPollFds: {
          kind: "pollfd-array",
          offset: pollFdOffset,
          entries: pollFds,
          byteOrder: "little-endian",
          pointerRegister: "rdi",
          pointerEncoding: "stack-relative",
        },
      }
    : provenance;
}

function syscallArgumentsProvenance(
  pollFds: NativeModeledPpollFdState[] | undefined,
): NativeSyntheticPpollSyscallArgumentProvenance[] {
  return [
    {
      register: "rax",
      role: "syscall-number",
      value: String(PPOLL_SYSCALL_AMD64),
      source: "linux-amd64-syscall-abi",
    },
    {
      register: "rdi",
      role: "fds-pointer",
      value: pollFds?.length === 1 ? "stack-relative-pollfd-array" : "0x0",
      source: pollFds?.length === 1 ? "modeled-source-ppoll-timeout" : "linux-amd64-syscall-abi",
    },
    {
      register: "rsi",
      role: "nfds",
      value: pollFds?.length === 1 ? "1" : "0",
      source: pollFds?.length === 1 ? "modeled-source-ppoll-timeout" : "linux-amd64-syscall-abi",
    },
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

function registerSetupNotes(pollFds: NativeModeledPpollFdState[] | undefined): string[] {
  return [
    "rax carries syscall 271 before ppoll",
    pollFds?.length === 1
      ? "rdi points at a stack-local modeled pollfd array and rsi carries nfds=1"
      : "rdi/rsi are zeroed for a NULL fd array with nfds=0",
    "rdx points at the embedded modeled timeout using RIP-relative addressing",
    "r10 is zeroed for a NULL signal mask",
    "r8 is zeroed for sigsetsize=0",
  ];
}

function ppollTimespecOffset(
  completionMode: NativeSyntheticPpollCompletionMode,
  pollFds: NativeModeledPpollFdState[] | undefined,
): number {
  if (pollFds?.length === 1) {
    return completionMode === "exit-process"
      ? EXITING_PPOLL_ONE_FD_TIMESPEC_OFFSET
      : RETURNING_PPOLL_ONE_FD_TIMESPEC_OFFSET;
  }
  return nativeSyntheticTimespecOffset({
    completionMode,
    returningTimespecOffset: RETURNING_PPOLL_TIMESPEC_OFFSET,
    exitingTimespecOffset: EXITING_PPOLL_TIMESPEC_OFFSET,
  });
}

function ppollPollFdOffset(
  completionMode: NativeSyntheticPpollCompletionMode,
  pollFds: NativeModeledPpollFdState[] | undefined,
): number | undefined {
  if (pollFds?.length !== 1) {
    return undefined;
  }
  return completionMode === "exit-process"
    ? EXITING_PPOLL_ONE_FD_POLLFD_STACK_OFFSET
    : RETURNING_PPOLL_ONE_FD_POLLFD_STACK_OFFSET;
}

function ppollCodeSize(
  completionMode: NativeSyntheticPpollCompletionMode,
  pollFds: NativeModeledPpollFdState[] | undefined,
): number {
  if (pollFds?.length === 1) {
    return completionMode === "exit-process"
      ? EXITING_PPOLL_ONE_FD_CODE_SIZE
      : RETURNING_PPOLL_ONE_FD_CODE_SIZE;
  }
  return completionMode === "exit-process" ? EXITING_PPOLL_CODE_SIZE : RETURNING_PPOLL_CODE_SIZE;
}
