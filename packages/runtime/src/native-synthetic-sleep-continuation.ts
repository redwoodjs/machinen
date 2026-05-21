/** Synthetic target-native sleep syscall continuation generation. */

import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type {
  NativeModeledSleepTimerRemainingTime,
  NativeModeledSleepTimerState,
} from "./native-active-syscall-policy.ts";

export const NATIVE_SYNTHETIC_SLEEP_SYSCALL_BUILD_ID = "machinen-synthetic-sleep-syscall-v1";
export const NATIVE_SYNTHETIC_SLEEP_SYSCALL_LOGICAL_NAME = "machinen-synthetic-sleep-syscall";
export const NATIVE_SYNTHETIC_SLEEP_SYSCALL_PATH = "machinen.synthetic://sleep-syscall";
export const NATIVE_SYNTHETIC_SLEEP_SYSCALL_BASE = "0x700200000000";

export interface NativeSyntheticSleepSyscallContinuationRequest {
  threadId: string;
  remainingTime: NativeModeledSleepTimerRemainingTime;
  sleepTimer?: NativeModeledSleepTimerState;
  targetAddress?: string;
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
const SYNTHETIC_SLEEP_TIMESPEC_OFFSET = 24;
const SYNTHETIC_SLEEP_CODE_SIZE = 40;
const MAX_SIGNED_I64 = 0x7fff_ffff_ffff_ffffn;
const MAX_NANOSECONDS = 999_999_999;

export function buildNativeSyntheticSleepSyscallContinuation(
  request: NativeSyntheticSleepSyscallContinuationRequest,
): NativeSyntheticSleepSyscallContinuationResult {
  const validation = validateRemainingTime(request);
  if (validation) {
    return { refusals: [validation] };
  }
  const bytes = syntheticClockNanosleepBytes(request.remainingTime);
  return {
    continuation: {
      kind: "synthetic-sleep-syscall",
      threadId: request.threadId,
      targetArch: "amd64",
      entryAddress: request.targetAddress ?? NATIVE_SYNTHETIC_SLEEP_SYSCALL_BASE,
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
      timespecOffset: SYNTHETIC_SLEEP_TIMESPEC_OFFSET,
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
): Uint8Array {
  const bytes = new Uint8Array(SYNTHETIC_SLEEP_CODE_SIZE);
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
  const ripAfterLea = 16;
  writeInt32Le(bytes, 12, SYNTHETIC_SLEEP_TIMESPEC_OFFSET - ripAfterLea);
  writeU64Le(bytes, SYNTHETIC_SLEEP_TIMESPEC_OFFSET, BigInt(remainingTime.seconds));
  writeU64Le(bytes, SYNTHETIC_SLEEP_TIMESPEC_OFFSET + 8, BigInt(remainingTime.nanoseconds));
  return bytes;
}

function writeInt32Le(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(offset, value, true);
}

function writeU64Le(bytes: Uint8Array, offset: number, value: bigint): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(offset, value, true);
}
