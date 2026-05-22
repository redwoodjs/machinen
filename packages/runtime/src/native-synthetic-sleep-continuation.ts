/** Synthetic target-native sleep syscall continuation generation. */

import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import {
  NATIVE_SYNTHETIC_SYSCALL_RESTART_EXIT_STATUS,
  NATIVE_SYNTHETIC_SYSCALL_UNMODELED_RETURN_EXIT_STATUS,
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
import type {
  NativeModeledSleepTimerRemainingTime,
  NativeModeledSleepTimerState,
} from "./native-active-syscall-policy.ts";

export const NATIVE_SYNTHETIC_SLEEP_SYSCALL_BUILD_ID = "machinen-synthetic-sleep-syscall-v3";
export const NATIVE_SYNTHETIC_SLEEP_SYSCALL_LOGICAL_NAME = "machinen-synthetic-sleep-syscall";
export const NATIVE_SYNTHETIC_SLEEP_SYSCALL_PATH = "machinen.synthetic://sleep-syscall";
export const NATIVE_SYNTHETIC_SLEEP_SYSCALL_BASE = "0x700200000000";
export const NATIVE_SYNTHETIC_SLEEP_SYSCALL_RESTART_EXIT_STATUS =
  NATIVE_SYNTHETIC_SYSCALL_RESTART_EXIT_STATUS;
export const NATIVE_SYNTHETIC_SLEEP_SYSCALL_UNMODELED_RETURN_EXIT_STATUS =
  NATIVE_SYNTHETIC_SYSCALL_UNMODELED_RETURN_EXIT_STATUS;
export const NATIVE_SYNTHETIC_SLEEP_SYSCALL_FAILURE_EXIT_STATUS =
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_RESTART_EXIT_STATUS;

export type NativeSyntheticSleepCompletionMode = "return-to-trampoline" | "exit-process";

export type NativeSyntheticSleepSyscallProvenanceSource =
  NativeSyntheticContinuationProvenanceSource;

export interface NativeSyntheticSleepSyscallArgumentProvenance extends NativeSyntheticSyscallArgumentDescriptor {
  register: "rax" | "rdi" | "rsi" | "rdx" | "r10";
  role: "syscall-number" | "clock-id" | "flags" | "request-timespec-pointer" | "remainder-pointer";
  source: NativeSyntheticSleepSyscallProvenanceSource;
}

export interface NativeSyntheticSleepSyscallRegisterSetupProvenance extends NativeSyntheticContinuationRegisterSetupDescriptor {
  arguments: NativeSyntheticSleepSyscallArgumentProvenance[];
  clobberedBySyscall: ["rax", "rcx", "r11"];
}

export interface NativeSyntheticSleepSyscallStackSetupProvenance extends NativeSyntheticContinuationStackSetupDescriptor {
  entryStackPointer: "target-caller-frame-stack-pointer";
  stackBytesWrittenByContinuation: 0;
  returnAddress: "trampoline-sentinel-return-address" | "not-used-exit-process-completion";
  requiresSourceStackBytes: false;
}

export interface NativeSyntheticSleepSyscallCompletionProvenance extends NativeSyntheticContinuationCompletionDescriptor {
  mode: NativeSyntheticSleepCompletionMode;
  successExitStatus?: 0;
  failureExitStatus?: typeof NATIVE_SYNTHETIC_SLEEP_SYSCALL_FAILURE_EXIT_STATUS;
  failureExitBuckets?: NativeSyntheticContinuationFailureExitBucket[];
}

export interface NativeSyntheticSleepSyscallContinuationProvenance extends NativeSyntheticSyscallContinuationDescriptor {
  generatorBuildId: typeof NATIVE_SYNTHETIC_SLEEP_SYSCALL_BUILD_ID;
  syscall: NativeSyntheticSyscallContinuationDescriptor["syscall"] & {
    name: "clock_nanosleep";
    number: 230;
    arguments: NativeSyntheticSleepSyscallArgumentProvenance[];
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
  registerSetup: NativeSyntheticSleepSyscallRegisterSetupProvenance;
  stackSetup: NativeSyntheticSleepSyscallStackSetupProvenance;
  completion: NativeSyntheticSleepSyscallCompletionProvenance;
}

export interface NativeSyntheticSleepSyscallContinuationRequest {
  threadId: string;
  remainingTime: NativeModeledSleepTimerRemainingTime;
  sleepTimer?: NativeModeledSleepTimerState;
  targetAddress?: string;
  completionMode?: NativeSyntheticSleepCompletionMode;
}

export interface NativeSyntheticSleepSyscallContinuation {
  kind: "synthetic-sleep-syscall";
  threadId: string;
  targetArch: "amd64";
  entryAddress: string;
  relativeAddress: "0x0";
  syscall: {
    name: "clock_nanosleep";
    number: 230;
    clockId: 0;
    flags: 0;
    requestPointerEncoding: "rip-relative-timespec";
    remainderPointer: "0x0";
  };
  remainingTime: NativeModeledSleepTimerRemainingTime;
  completionMode: NativeSyntheticSleepCompletionMode;
  exitStatusOnSuccess?: 0;
  descriptor: NativeSyntheticSyscallContinuationDescriptor;
  provenance: NativeSyntheticSleepSyscallContinuationProvenance;
  timespecOffset: number;
  sizeBytes: number;
  bytes: Uint8Array;
  sourceTextReusedAsTargetCode: false;
  sourceIsaEmulationUsed: false;
  sidecarRuntimeUsed: false;
}

export interface NativeSyntheticSleepSyscallContinuationResult {
  continuation?: NativeSyntheticSleepSyscallContinuation;
  refusals: NativeProcessImageRefusal[];
}

const CLOCK_NANOSLEEP_SYSCALL_AMD64 = 230;
const RETURNING_SLEEP_TIMESPEC_OFFSET = 24;
const RETURNING_SLEEP_CODE_SIZE = 40;
const EXITING_SLEEP_TIMESPEC_OFFSET = 104;
const EXITING_SLEEP_CODE_SIZE = 120;
const MAX_SIGNED_I64 = 0x7fff_ffff_ffff_ffffn;
const MAX_NANOSECONDS = 999_999_999;

export function buildNativeSyntheticSleepSyscallContinuation(
  request: NativeSyntheticSleepSyscallContinuationRequest,
): NativeSyntheticSleepSyscallContinuationResult {
  const validation = validateRemainingTime(request);
  if (validation) {
    return { refusals: [validation] };
  }
  const completionMode = request.completionMode ?? "return-to-trampoline";
  const bytes = syntheticClockNanosleepBytes(request.remainingTime, completionMode);
  const timespecOffset = sleepTimespecOffset(completionMode);
  const entryAddress = request.targetAddress ?? NATIVE_SYNTHETIC_SLEEP_SYSCALL_BASE;
  const descriptor = syntheticClockNanosleepDescriptor(bytes, entryAddress, completionMode);
  return {
    continuation: {
      kind: "synthetic-sleep-syscall",
      threadId: request.threadId,
      targetArch: "amd64",
      entryAddress,
      relativeAddress: "0x0",
      syscall: {
        name: "clock_nanosleep",
        number: CLOCK_NANOSLEEP_SYSCALL_AMD64,
        clockId: 0,
        flags: 0,
        requestPointerEncoding: "rip-relative-timespec",
        remainderPointer: "0x0",
      },
      remainingTime: request.remainingTime,
      completionMode,
      exitStatusOnSuccess: completionMode === "exit-process" ? 0 : undefined,
      descriptor,
      provenance: syntheticClockNanosleepProvenance(
        descriptor,
        request.remainingTime,
        timespecOffset,
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
  request: NativeSyntheticSleepSyscallContinuationRequest,
): NativeProcessImageRefusal | undefined {
  const seconds = BigInt(request.remainingTime.seconds);
  if (seconds > MAX_SIGNED_I64 || request.remainingTime.nanoseconds > MAX_NANOSECONDS) {
    return {
      code: "target-sleep-syscall-continuation-missing",
      message: `thread ${request.threadId} modeled sleep duration is outside amd64 timespec bounds`,
      detail: { remainingTime: request.remainingTime, sleepTimer: request.sleepTimer },
    };
  }
  return undefined;
}

function syntheticClockNanosleepBytes(
  remainingTime: NativeModeledSleepTimerRemainingTime,
  completionMode: NativeSyntheticSleepCompletionMode,
): Uint8Array {
  const bytes = new Uint8Array(sleepCodeSize(completionMode));
  bytes.set(
    [
      0xb8,
      0xe6,
      0x00,
      0x00,
      0x00, // mov eax, 230 (clock_nanosleep)
      0x31,
      0xff, // xor edi, edi (CLOCK_REALTIME)
      0x31,
      0xf6, // xor esi, esi (relative flags)
      0x48,
      0x8d,
      0x15, // lea rdx, [rip + timespec]
      0x00,
      0x00,
      0x00,
      0x00,
      0x45,
      0x31,
      0xd2, // xor r10d, r10d (NULL remainder)
      0x0f,
      0x05, // syscall
      0xc3, // ret to trampoline sentinel
      0x90,
      0x90, // align embedded timespec to 8 bytes
    ],
    0,
  );
  if (completionMode === "exit-process") {
    bytes.set(nativeSyntheticExitProcessSuffix(), 21);
  }
  const timespecOffset = sleepTimespecOffset(completionMode);
  writeNativeSyntheticRipRelativeTimespec(bytes, timespecOffset, remainingTime);
  return bytes;
}

function syntheticClockNanosleepDescriptor(
  bytes: Uint8Array,
  entryAddress: string,
  completionMode: NativeSyntheticSleepCompletionMode,
): NativeSyntheticSyscallContinuationDescriptor {
  return buildNativeSyntheticModeledSyscallDescriptor({
    entryAddress,
    generatorBuildId: NATIVE_SYNTHETIC_SLEEP_SYSCALL_BUILD_ID,
    bytes,
    syscallName: "clock_nanosleep",
    syscallNumber: CLOCK_NANOSLEEP_SYSCALL_AMD64,
    argumentsProvenance: syscallArgumentsProvenance(),
    registerSetupNotes: [
      "rax carries syscall 230 before clock_nanosleep",
      "rdi/rsi are zeroed for CLOCK_REALTIME relative sleep",
      "rdx points at the embedded modeled timespec using RIP-relative addressing",
      "r10 is zeroed for a NULL remainder pointer",
    ],
    completionMode,
    completionOverrides: {
      failureExitStatus:
        completionMode === "exit-process"
          ? NATIVE_SYNTHETIC_SLEEP_SYSCALL_FAILURE_EXIT_STATUS
          : undefined,
      failureKind: completionMode === "exit-process" ? "signal-restart-unsupported" : undefined,
      failureReason:
        completionMode === "exit-process"
          ? "sleep syscall failure may need EINTR/restart handling, which is not modeled"
          : undefined,
    },
  });
}

function syntheticClockNanosleepProvenance(
  descriptor: NativeSyntheticSyscallContinuationDescriptor,
  remainingTime: NativeModeledSleepTimerRemainingTime,
  timespecOffset: number,
): NativeSyntheticSleepSyscallContinuationProvenance {
  return nativeSyntheticSyscallTimespecProvenance(
    descriptor,
    remainingTime,
    timespecOffset,
  ) as NativeSyntheticSleepSyscallContinuationProvenance;
}

function syscallArgumentsProvenance(): NativeSyntheticSleepSyscallArgumentProvenance[] {
  return [
    {
      register: "rax",
      role: "syscall-number",
      value: String(CLOCK_NANOSLEEP_SYSCALL_AMD64),
      source: "linux-amd64-syscall-abi",
    },
    { register: "rdi", role: "clock-id", value: "0", source: "linux-amd64-syscall-abi" },
    { register: "rsi", role: "flags", value: "0", source: "linux-amd64-syscall-abi" },
    {
      register: "rdx",
      role: "request-timespec-pointer",
      value: "rip-relative-timespec",
      source: "modeled-source-sleep-timer",
    },
    { register: "r10", role: "remainder-pointer", value: "0x0", source: "linux-amd64-syscall-abi" },
  ];
}

function sleepTimespecOffset(completionMode: NativeSyntheticSleepCompletionMode): number {
  return completionMode === "exit-process"
    ? EXITING_SLEEP_TIMESPEC_OFFSET
    : RETURNING_SLEEP_TIMESPEC_OFFSET;
}

function sleepCodeSize(completionMode: NativeSyntheticSleepCompletionMode): number {
  return completionMode === "exit-process" ? EXITING_SLEEP_CODE_SIZE : RETURNING_SLEEP_CODE_SIZE;
}
