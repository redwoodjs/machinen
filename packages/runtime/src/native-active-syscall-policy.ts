/** Active native syscall classification for actual real-utility attempts. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nativeFdAccessMode, nativeFdFlagBits } from "./native-fd-flags.ts";
import {
  NATIVE_PROCESS_IMAGE_FILES,
  type NativeMemoryMapping,
  type NativeProcessImageDocuments,
  type NativeProcessImageRefusal,
  type NativeProcessResource,
  type NativeThreadState,
} from "./native-process-image.ts";

export type NativeActiveSyscallClass =
  | "outside-syscall"
  | "sleep-timer"
  | "poll-timeout"
  | "fd-blocking"
  | "restart"
  | "unknown-active";

export type NativeSleepTimerSyscallPolicy = "refuse" | "defer-target-resume";
export type NativePollTimeoutSyscallPolicy = "refuse" | "defer-target-resume";
export type NativePollTimeoutFdPolicy =
  | "zero-fd-only"
  | "synthetic-empty-pipe"
  | "synthetic-empty-eventfd"
  | "synthetic-timerfd";

export interface NativeActiveSyscallPolicyOptions {
  sleepTimerPolicy?: NativeSleepTimerSyscallPolicy;
  pollTimeoutPolicy?: NativePollTimeoutSyscallPolicy;
  pollTimeoutFdPolicy?: NativePollTimeoutFdPolicy;
  documents?: NativeProcessImageDocuments;
}

export interface NativeSleepTimerDuration {
  seconds: string;
  nanoseconds: number;
}

export interface NativeModeledSleepTimerRemainingTime extends NativeSleepTimerDuration {
  state: "modeled";
  kind: "relative-duration";
  source: "active-syscall-request-timespec";
  precision: "requested-duration-upper-bound";
}

export interface NativeModeledPpollTimeoutRemainingTime extends NativeSleepTimerDuration {
  state: "modeled";
  kind: "relative-duration";
  source: "active-syscall-ppoll-timeout";
  precision: "requested-duration-upper-bound";
}

export interface NativeModeledSleepTimerState {
  kind: "relative-duration";
  syscallName: string;
  argumentSource: "proc-syscall" | "registers";
  clockId?: number;
  flags?: number;
  requestPointer: string;
  remainderPointer?: string;
  requestedTime: NativeSleepTimerDuration;
  remainingTime: NativeModeledSleepTimerRemainingTime;
}

export type NativeModeledPpollTargetResource =
  | "synthetic-empty-pipe-read-end"
  | "synthetic-empty-eventfd"
  | "synthetic-timerfd";

export interface NativeModeledPpollFdState {
  fd: number;
  events: number;
  revents: number;
  sourceAddress: string;
  resourceId?: string;
  targetResource: NativeModeledPpollTargetResource;
}

export interface NativeModeledPpollTimeoutState {
  kind: "relative-duration";
  syscallName: "ppoll";
  argumentSource: "proc-syscall" | "registers";
  fdsPointer: string;
  nfds: 0 | 1;
  pollFds?: NativeModeledPpollFdState[];
  timeoutPointer: string;
  sigmaskPointer: "0x0";
  sigsetSize?: string;
  requestedTime: NativeSleepTimerDuration;
  remainingTime: NativeModeledPpollTimeoutRemainingTime;
}

export type NativeSleepTimerModelResult =
  | { state: "modeled"; timer: NativeModeledSleepTimerState }
  | { state: "missing"; refusal: NativeProcessImageRefusal };

export type NativePpollTimeoutModelResult =
  | { state: "modeled"; timeout: NativeModeledPpollTimeoutState }
  | { state: "missing"; refusal: NativeProcessImageRefusal };

export interface NativeActiveSleepTimerContinuation {
  threadId: string;
  syscallClass: Extract<NativeActiveSyscallClass, "sleep-timer">;
  action: "defer-target-resume";
  syscall: NativeThreadState["syscall"];
  metadata: {
    remainingTime: NativeModeledSleepTimerRemainingTime;
    sleepTimer: NativeModeledSleepTimerState;
    policy: "conservative-target-timer-rearm-required";
  };
}

export interface NativeActivePpollTimeoutContinuation {
  threadId: string;
  syscallClass: Extract<NativeActiveSyscallClass, "poll-timeout">;
  action: "defer-target-resume";
  syscall: NativeThreadState["syscall"];
  metadata: {
    remainingTime: NativeModeledPpollTimeoutRemainingTime;
    ppollTimeout: NativeModeledPpollTimeoutState;
    policy: "conservative-target-ppoll-timeout-rearm-required";
  };
}

export type NativeActiveSyscallContinuation =
  | NativeActiveSleepTimerContinuation
  | NativeActivePpollTimeoutContinuation;

export interface NativeActiveSyscallClassification {
  threadId: string;
  state: NativeThreadState["syscall"]["state"];
  syscallNumber?: number;
  syscallName?: string;
  class: NativeActiveSyscallClass;
  resumable: false;
  refusal?: NativeProcessImageRefusal;
  continuation?: NativeActiveSyscallContinuation;
}

export interface NativeActiveSyscallClassificationResult {
  classifications: NativeActiveSyscallClassification[];
  refusals: NativeProcessImageRefusal[];
  continuations: NativeActiveSyscallContinuation[];
}

const SLEEP_TIMER_SYSCALLS = new Set(["clock_nanosleep", "nanosleep"]);
const FD_BLOCKING_SYSCALLS = new Set([
  "read",
  "write",
  "poll",
  "ppoll",
  "select",
  "pselect6",
  "epoll_wait",
  "epoll_pwait",
  "accept",
  "accept4",
  "connect",
  "recvfrom",
  "recvmsg",
  "sendto",
  "sendmsg",
]);
const TIMER_ABSTIME = 1;
const TIMESPEC_SIZE_BYTES = 16n;
const POLLFD_SIZE_BYTES = 8n;
const POLLIN = 0x1;
const SUPPORTED_EMPTY_EVENTFD_FLAGS = 0o2000002;
const SUPPORTED_TIMERFD_FLAGS = 0o2000002;
const MAX_SIGNED_I64 = 0x7fff_ffff_ffff_ffffn;
const MAX_NANOSECONDS = 999_999_999n;

export function classifyNativeActiveSyscalls(
  threads: NativeThreadState[],
  options: NativeActiveSyscallPolicyOptions = {},
): NativeActiveSyscallClassificationResult {
  const classifications = threads.map((thread) => classifyNativeThreadSyscall(thread, options));
  return {
    classifications,
    refusals: classifications.flatMap((classification) =>
      classification.refusal ? [classification.refusal] : [],
    ),
    continuations: classifications.flatMap((classification) =>
      classification.continuation ? [classification.continuation] : [],
    ),
  };
}

export function classifyNativeThreadSyscall(
  thread: NativeThreadState,
  options: NativeActiveSyscallPolicyOptions = {},
): NativeActiveSyscallClassification {
  if (thread.syscall.state === "outside-syscall") {
    return baseClassification(thread, "outside-syscall");
  }
  if (thread.syscall.state === "restart-block" || syscallName(thread) === "restart_syscall") {
    return refusedClassification(thread, "restart", {
      code: "syscall-restart-unsupported",
      message: `thread ${thread.id} is in restartable syscall state`,
      detail: detail(thread, "restart"),
    });
  }
  const name = syscallName(thread);
  if (SLEEP_TIMER_SYSCALLS.has(name)) {
    if (options.sleepTimerPolicy === "defer-target-resume") {
      return deferredSleepTimerClassification(thread, options);
    }
    return refusedClassification(thread, "sleep-timer", {
      code: "blocking-syscall-state-unsupported",
      message: `thread ${thread.id} is blocked in sleep/timer syscall ${name}`,
      detail: detail(thread, "sleep-timer", {
        requiredModel: ["remaining time", "restart/result contract", "target timer rearm policy"],
      }),
    });
  }
  if (name === "ppoll" && options.pollTimeoutPolicy === "defer-target-resume") {
    return deferredPpollTimeoutClassification(thread, options);
  }
  if (FD_BLOCKING_SYSCALLS.has(name)) {
    return refusedClassification(thread, "fd-blocking", {
      code: "blocking-syscall-state-unsupported",
      message: `thread ${thread.id} is blocked in fd syscall ${name}`,
      detail: detail(thread, "fd-blocking", {
        requiredModel: ["fd readiness", "partial transfer state", "target fd resource mapping"],
      }),
    });
  }
  return refusedClassification(thread, "unknown-active", {
    code: "active-syscall",
    message: `thread ${thread.id} is in unclassified active syscall state`,
    detail: detail(thread, "unknown-active"),
  });
}

export function modelNativePpollTimeoutState(
  thread: NativeThreadState,
  documents?: NativeProcessImageDocuments,
  fdPolicy: NativePollTimeoutFdPolicy = "zero-fd-only",
): NativePpollTimeoutModelResult {
  const args = sleepTimerArguments(thread);
  if (!args) {
    return missingPpollTimeout(thread, "syscall arguments were not captured");
  }
  const decoded = decodePpollTimeoutArguments(thread, args, documents, fdPolicy);
  if ("refusal" in decoded) {
    return decoded;
  }
  if (!documents?.rootDir) {
    return missingPpollTimeout(thread, "captured memory bundle is not available", {
      argumentSource: args.source,
      timeoutPointer: hex(decoded.timeoutPointer),
    });
  }
  const timespec = readCapturedTimespec(documents, decoded.timeoutPointer);
  if ("refusal" in timespec) {
    return {
      state: "missing",
      refusal: missingPpollTimeoutRefusal(thread, timespec.reason, decodedPpollDetail(decoded)),
    };
  }
  const remainingTime: NativeModeledPpollTimeoutRemainingTime = {
    ...timespec.duration,
    state: "modeled",
    kind: "relative-duration",
    source: "active-syscall-ppoll-timeout",
    precision: "requested-duration-upper-bound",
  };
  return {
    state: "modeled",
    timeout: {
      kind: "relative-duration",
      syscallName: "ppoll",
      argumentSource: args.source,
      fdsPointer: hex(decoded.fdsPointer),
      nfds: decoded.nfds,
      pollFds: decoded.pollFds,
      timeoutPointer: hex(decoded.timeoutPointer),
      sigmaskPointer: "0x0",
      sigsetSize: hex(decoded.sigsetSize),
      requestedTime: timespec.duration,
      remainingTime,
    },
  };
}

export function modelNativeSleepTimerState(
  thread: NativeThreadState,
  documents?: NativeProcessImageDocuments,
): NativeSleepTimerModelResult {
  const args = sleepTimerArguments(thread);
  if (!args) {
    return missingSleepTimer(thread, "syscall arguments were not captured");
  }
  if (!documents?.rootDir) {
    return missingSleepTimer(thread, "captured memory bundle is not available", {
      argumentSource: args.source,
    });
  }
  const syscall = syscallName(thread);
  const decoded = decodeSleepTimerArguments(thread, syscall, args);
  if ("refusal" in decoded) {
    return decoded;
  }
  const timespec = readCapturedTimespec(documents, decoded.requestPointer);
  if ("refusal" in timespec) {
    return {
      state: "missing",
      refusal: missingSleepTimerRefusal(thread, timespec.reason, decodedSleepDetail(decoded)),
    };
  }
  const remainingTime: NativeModeledSleepTimerRemainingTime = {
    ...timespec.duration,
    state: "modeled",
    kind: "relative-duration",
    source: "active-syscall-request-timespec",
    precision: "requested-duration-upper-bound",
  };
  return {
    state: "modeled",
    timer: {
      kind: "relative-duration",
      syscallName: syscall,
      argumentSource: args.source,
      clockId: decoded.clockId,
      flags: decoded.flags,
      requestPointer: hex(decoded.requestPointer),
      remainderPointer: decoded.remainderPointer ? hex(decoded.remainderPointer) : undefined,
      requestedTime: timespec.duration,
      remainingTime,
    },
  };
}

function baseClassification(
  thread: NativeThreadState,
  syscallClass: NativeActiveSyscallClass,
): NativeActiveSyscallClassification {
  return {
    threadId: thread.id,
    state: thread.syscall.state,
    syscallNumber: thread.syscall.number,
    syscallName: thread.syscall.name,
    class: syscallClass,
    resumable: false,
  };
}

function refusedClassification(
  thread: NativeThreadState,
  syscallClass: NativeActiveSyscallClass,
  refusal: NativeProcessImageRefusal,
): NativeActiveSyscallClassification {
  return { ...baseClassification(thread, syscallClass), refusal };
}

function deferredSleepTimerClassification(
  thread: NativeThreadState,
  options: NativeActiveSyscallPolicyOptions,
): NativeActiveSyscallClassification {
  const modeled = modelNativeSleepTimerState(thread, options.documents);
  if (modeled.state === "missing") {
    return refusedClassification(thread, "sleep-timer", modeled.refusal);
  }
  return {
    ...baseClassification(thread, "sleep-timer"),
    continuation: {
      threadId: thread.id,
      syscallClass: "sleep-timer",
      action: "defer-target-resume",
      syscall: thread.syscall,
      metadata: {
        remainingTime: modeled.timer.remainingTime,
        sleepTimer: modeled.timer,
        policy: "conservative-target-timer-rearm-required",
      },
    },
  };
}

function deferredPpollTimeoutClassification(
  thread: NativeThreadState,
  options: NativeActiveSyscallPolicyOptions,
): NativeActiveSyscallClassification {
  const modeled = modelNativePpollTimeoutState(
    thread,
    options.documents,
    options.pollTimeoutFdPolicy,
  );
  if (modeled.state === "missing") {
    return refusedClassification(thread, "poll-timeout", modeled.refusal);
  }
  return {
    ...baseClassification(thread, "poll-timeout"),
    continuation: {
      threadId: thread.id,
      syscallClass: "poll-timeout",
      action: "defer-target-resume",
      syscall: thread.syscall,
      metadata: {
        remainingTime: modeled.timeout.remainingTime,
        ppollTimeout: modeled.timeout,
        policy: "conservative-target-ppoll-timeout-rearm-required",
      },
    },
  };
}

interface SleepTimerArguments {
  source: "proc-syscall" | "registers";
  values: bigint[];
}

function sleepTimerArguments(thread: NativeThreadState): SleepTimerArguments | undefined {
  const syscallArgs = parseSyscallArguments(thread.syscall.arguments);
  if (syscallArgs) {
    return { source: "proc-syscall", values: syscallArgs };
  }
  const registerArgs = registerSyscallArguments(thread);
  return registerArgs ? { source: "registers", values: registerArgs } : undefined;
}

function parseSyscallArguments(args: string[] | undefined): bigint[] | undefined {
  if (!args || args.length < 6) {
    return undefined;
  }
  try {
    return args.slice(0, 6).map((arg) => BigInt(arg));
  } catch {
    return undefined;
  }
}

function registerSyscallArguments(thread: NativeThreadState): bigint[] | undefined {
  const registers = thread.sourceRegisters;
  if (registers.arch === "arm64") {
    const args = registers.x.slice(0, 6);
    return args.length === 6 ? args.map((value) => BigInt(value)) : undefined;
  }
  return [
    registers.rdi,
    registers.rsi,
    registers.rdx,
    registers.r10,
    registers.r8,
    registers.r9,
  ].map((value) => BigInt(value));
}

type DecodedSleepTimerArguments =
  | {
      requestPointer: bigint;
      remainderPointer?: bigint;
      clockId?: number;
      flags?: number;
    }
  | { state: "missing"; refusal: NativeProcessImageRefusal };

function decodeSleepTimerArguments(
  thread: NativeThreadState,
  syscall: string,
  args: SleepTimerArguments,
): DecodedSleepTimerArguments {
  return syscall === "nanosleep"
    ? decodeNanosleepArguments(thread, args)
    : decodeClockNanosleepArguments(thread, args);
}

type DecodedPpollTimeoutArguments =
  | {
      fdsPointer: bigint;
      nfds: 0 | 1;
      pollFds?: NativeModeledPpollFdState[];
      timeoutPointer: bigint;
      sigsetSize: bigint;
    }
  | { state: "missing"; refusal: NativeProcessImageRefusal };

interface PpollArgumentValues {
  fdsPointer: bigint;
  nfds: bigint;
  timeoutPointer: bigint;
  sigmaskPointer: bigint;
  sigsetSize: bigint;
}

function decodePpollTimeoutArguments(
  thread: NativeThreadState,
  args: SleepTimerArguments,
  documents: NativeProcessImageDocuments | undefined,
  fdPolicy: NativePollTimeoutFdPolicy,
): DecodedPpollTimeoutArguments {
  const values = ppollArgumentValues(args);
  const unsupported =
    unsupportedPpollTimeout(thread, values) ?? unsupportedPpollSigmask(thread, args, values);
  if (unsupported) {
    return unsupported;
  }
  const decodedFds = decodePpollFds(thread, args, values, documents, fdPolicy);
  if ("state" in decodedFds) {
    return decodedFds;
  }
  return {
    ...decodedFds,
    timeoutPointer: values.timeoutPointer,
    sigsetSize: values.sigsetSize,
  };
}

function ppollArgumentValues(args: SleepTimerArguments): PpollArgumentValues {
  return {
    fdsPointer: args.values[0] ?? 0n,
    nfds: args.values[1] ?? 0n,
    timeoutPointer: args.values[2] ?? 0n,
    sigmaskPointer: args.values[3] ?? 0n,
    sigsetSize: args.values[4] ?? 0n,
  };
}

function decodePpollFds(
  thread: NativeThreadState,
  args: SleepTimerArguments,
  values: PpollArgumentValues,
  documents: NativeProcessImageDocuments | undefined,
  fdPolicy: NativePollTimeoutFdPolicy = "zero-fd-only",
):
  | { fdsPointer: bigint; nfds: 0 | 1; pollFds?: NativeModeledPpollFdState[] }
  | { state: "missing"; refusal: NativeProcessImageRefusal } {
  if (values.nfds === 0n && values.fdsPointer === 0n) {
    return { fdsPointer: values.fdsPointer, nfds: 0 };
  }
  if (!isModeledPpollOneFdPolicy(fdPolicy)) {
    return missingPpollTimeout(thread, "ppoll fd readiness is not modeled yet", {
      nfds: hex(values.nfds),
      fdsPointer: hex(values.fdsPointer),
      argumentSource: args.source,
    });
  }
  if (values.nfds !== 1n) {
    return missingPpollTimeout(thread, oneFdPolicyLabel(fdPolicy), {
      nfds: hex(values.nfds),
      fdsPointer: hex(values.fdsPointer),
      argumentSource: args.source,
    });
  }
  if (values.fdsPointer === 0n) {
    return missingPpollTimeout(thread, "ppoll one-fd proof requires a pollfd pointer", {
      fdsPointer: hex(values.fdsPointer),
      argumentSource: args.source,
    });
  }
  const pollFd = readCapturedPollFd(thread, documents, values.fdsPointer, fdPolicy);
  if ("state" in pollFd) {
    return pollFd;
  }
  return { fdsPointer: values.fdsPointer, nfds: 1, pollFds: [pollFd] };
}

function isModeledPpollOneFdPolicy(fdPolicy: NativePollTimeoutFdPolicy): boolean {
  return ["synthetic-empty-pipe", "synthetic-empty-eventfd", "synthetic-timerfd"].includes(
    fdPolicy,
  );
}

function oneFdPolicyLabel(fdPolicy: NativePollTimeoutFdPolicy): string {
  if (fdPolicy === "synthetic-empty-eventfd") {
    return "ppoll synthetic empty-eventfd proof supports exactly one fd";
  }
  return fdPolicy === "synthetic-timerfd"
    ? "ppoll synthetic timerfd proof supports exactly one fd"
    : "ppoll synthetic empty-pipe proof supports exactly one fd";
}

function unsupportedPpollTimeout(
  thread: NativeThreadState,
  values: PpollArgumentValues,
): DecodedPpollTimeoutArguments | undefined {
  return values.timeoutPointer === 0n
    ? missingPpollTimeout(thread, "ppoll timeout pointer is null")
    : undefined;
}

function unsupportedPpollSigmask(
  thread: NativeThreadState,
  args: SleepTimerArguments,
  values: PpollArgumentValues,
): DecodedPpollTimeoutArguments | undefined {
  return values.sigmaskPointer !== 0n
    ? missingPpollTimeout(thread, "ppoll signal masks are not modeled yet", {
        sigmaskPointer: hex(values.sigmaskPointer),
        sigsetSize: hex(values.sigsetSize),
        argumentSource: args.source,
      })
    : undefined;
}

function decodeNanosleepArguments(
  thread: NativeThreadState,
  args: SleepTimerArguments,
): DecodedSleepTimerArguments {
  return decodeRelativeSleepPointers(thread, args.values[0] ?? 0n, args.values[1]);
}

function decodeClockNanosleepArguments(
  thread: NativeThreadState,
  args: SleepTimerArguments,
): DecodedSleepTimerArguments {
  const flags = decodeClockNanosleepFlags(thread, args);
  if ("refusal" in flags) {
    return flags;
  }
  const decoded = decodeRelativeSleepPointers(thread, args.values[2] ?? 0n, args.values[3]);
  if ("refusal" in decoded) {
    return decoded;
  }
  return { ...decoded, clockId: safeNumber(args.values[0] ?? 0n), flags: flags.value };
}

function decodeClockNanosleepFlags(
  thread: NativeThreadState,
  args: SleepTimerArguments,
): { value: number } | { state: "missing"; refusal: NativeProcessImageRefusal } {
  const flags = safeNumber(args.values[1] ?? 0n);
  if (flags === undefined) {
    return missingSleepTimer(thread, "clock_nanosleep flags do not fit in a safe integer", {
      flags: hex(args.values[1] ?? 0n),
      argumentSource: args.source,
    });
  }
  if ((flags & TIMER_ABSTIME) !== 0) {
    return missingSleepTimer(thread, "absolute clock_nanosleep deadlines are not modeled yet", {
      flags,
      argumentSource: args.source,
    });
  }
  return { value: flags };
}

function decodeRelativeSleepPointers(
  thread: NativeThreadState,
  requestPointer: bigint,
  remainderPointer: bigint | undefined,
):
  | { requestPointer: bigint; remainderPointer?: bigint }
  | { state: "missing"; refusal: NativeProcessImageRefusal } {
  if (requestPointer === 0n) {
    return missingSleepTimer(thread, "sleep request timespec pointer is null");
  }
  return { requestPointer, remainderPointer };
}

function decodedSleepDetail(decoded: {
  requestPointer: bigint;
  remainderPointer?: bigint;
  clockId?: number;
  flags?: number;
}): Record<string, unknown> {
  return {
    requestPointer: hex(decoded.requestPointer),
    remainderPointer: decoded.remainderPointer ? hex(decoded.remainderPointer) : undefined,
    clockId: decoded.clockId,
    flags: decoded.flags,
  };
}

function readCapturedPollFd(
  thread: NativeThreadState,
  documents: NativeProcessImageDocuments | undefined,
  sourceAddress: bigint,
  fdPolicy: NativePollTimeoutFdPolicy,
): NativeModeledPpollFdState | { state: "missing"; refusal: NativeProcessImageRefusal } {
  if (!documents?.rootDir) {
    return missingPpollTimeout(thread, "captured memory bundle is not available", {
      fdsPointer: hex(sourceAddress),
    });
  }
  const pollFdBytes = readCapturedMemoryRange(
    documents,
    sourceAddress,
    POLLFD_SIZE_BYTES,
    "ppoll pollfd array",
  );
  if ("refusal" in pollFdBytes) {
    return missingPpollTimeout(thread, pollFdBytes.reason, { fdsPointer: hex(sourceAddress) });
  }
  const fd = pollFdBytes.bytes.readInt32LE(0);
  const events = pollFdBytes.bytes.readInt16LE(4);
  const revents = pollFdBytes.bytes.readInt16LE(6);
  return validatePpollModeledFd(
    thread,
    documents,
    sourceAddress,
    { fd, events, revents },
    fdPolicy,
  );
}

function validatePpollModeledFd(
  thread: NativeThreadState,
  documents: NativeProcessImageDocuments,
  sourceAddress: bigint,
  pollFd: { fd: number; events: number; revents: number },
  fdPolicy: NativePollTimeoutFdPolicy,
): NativeModeledPpollFdState | { state: "missing"; refusal: NativeProcessImageRefusal } {
  const entryRefusal = validatePpollFdEntry(thread, pollFd);
  if (entryRefusal) {
    return entryRefusal;
  }
  const resource = validatePpollModeledResource(thread, documents, pollFd, fdPolicy);
  if ("state" in resource) {
    return resource;
  }
  return {
    ...pollFd,
    sourceAddress: hex(sourceAddress),
    resourceId: resource.resource.id,
    targetResource: resource.targetResource,
  };
}

function validatePpollFdEntry(
  thread: NativeThreadState,
  pollFd: { fd: number; events: number; revents: number },
): { state: "missing"; refusal: NativeProcessImageRefusal } | undefined {
  if (pollFd.fd < 0) {
    return missingPpollTimeout(thread, "ppoll disabled pollfd entries are not modeled", pollFd);
  }
  return pollFd.events !== POLLIN || pollFd.revents !== 0
    ? missingPpollTimeout(thread, "ppoll one-fd proof only models POLLIN with empty revents", {
        ...pollFd,
        requiredEvents: POLLIN,
      })
    : undefined;
}

function validatePpollModeledResource(
  thread: NativeThreadState,
  documents: NativeProcessImageDocuments,
  pollFd: { fd: number; events: number; revents: number },
  fdPolicy: NativePollTimeoutFdPolicy,
):
  | { resource: NativeProcessResource; targetResource: NativeModeledPpollTargetResource }
  | { state: "missing"; refusal: NativeProcessImageRefusal } {
  if (fdPolicy === "synthetic-empty-eventfd") {
    return validatePpollEventfdResource(thread, documents, pollFd);
  }
  if (fdPolicy === "synthetic-timerfd") {
    return validatePpollTimerfdResource(thread, documents, pollFd);
  }
  return validatePpollPipeResource(thread, documents, pollFd);
}

function validatePpollPipeResource(
  thread: NativeThreadState,
  documents: NativeProcessImageDocuments,
  pollFd: { fd: number; events: number; revents: number },
):
  | { resource: NativeProcessResource; targetResource: "synthetic-empty-pipe-read-end" }
  | { state: "missing"; refusal: NativeProcessImageRefusal } {
  const resource = documents.resources.resources.find((candidate) => candidate.fd === pollFd.fd);
  if (resource?.kind !== "pipe") {
    return missingPpollTimeout(thread, "ppoll one-fd proof requires a captured pipe fd", {
      ...pollFd,
      resourceKind: resource?.kind,
      resourceId: resource?.id,
    });
  }
  return nativeFdAccessMode(resource.flags) !== 0
    ? missingPpollTimeout(thread, "ppoll one-fd proof requires a pipe read end", {
        ...pollFd,
        resourceId: resource.id,
        resourceFlags: resource.flags,
      })
    : { resource, targetResource: "synthetic-empty-pipe-read-end" };
}

function validatePpollEventfdResource(
  thread: NativeThreadState,
  documents: NativeProcessImageDocuments,
  pollFd: { fd: number; events: number; revents: number },
):
  | { resource: NativeProcessResource; targetResource: "synthetic-empty-eventfd" }
  | { state: "missing"; refusal: NativeProcessImageRefusal } {
  const resource = documents.resources.resources.find((candidate) => candidate.fd === pollFd.fd);
  if (resource?.kind !== "eventfd") {
    return missingPpollTimeout(thread, "ppoll one-fd proof requires a captured eventfd fd", {
      ...pollFd,
      resourceKind: resource?.kind,
      resourceId: resource?.id,
    });
  }
  if (nativeFdAccessMode(resource.flags) !== 2) {
    return missingPpollTimeout(thread, "ppoll one-fd eventfd proof requires read/write access", {
      ...pollFd,
      resourceId: resource.id,
      resourceFlags: resource.flags,
    });
  }
  if (nativeFdFlagBits(resource.flags) !== SUPPORTED_EMPTY_EVENTFD_FLAGS) {
    return missingPpollTimeout(thread, "ppoll one-fd eventfd proof requires supported flags", {
      ...pollFd,
      resourceId: resource.id,
      resourceFlags: resource.flags,
      supportedFlags: `octal:${SUPPORTED_EMPTY_EVENTFD_FLAGS.toString(8)}`,
    });
  }
  const eventfdCount = nativeResourceBigInt(resource, "eventfdCount");
  if (eventfdCount !== 0n) {
    return missingPpollTimeout(thread, "ppoll one-fd eventfd proof requires an empty eventfd", {
      ...pollFd,
      resourceId: resource.id,
      eventfdCount: eventfdCount?.toString(10),
    });
  }
  const eventfdSemaphore = nativeResourceBigInt(resource, "eventfdSemaphore");
  return eventfdSemaphore !== 0n
    ? missingPpollTimeout(thread, "ppoll one-fd eventfd proof does not model semaphore mode", {
        ...pollFd,
        resourceId: resource.id,
        eventfdSemaphore: eventfdSemaphore?.toString(10),
      })
    : { resource, targetResource: "synthetic-empty-eventfd" };
}

function validatePpollTimerfdResource(
  thread: NativeThreadState,
  documents: NativeProcessImageDocuments,
  pollFd: { fd: number; events: number; revents: number },
):
  | { resource: NativeProcessResource; targetResource: "synthetic-timerfd" }
  | { state: "missing"; refusal: NativeProcessImageRefusal } {
  const resource = documents.resources.resources.find((candidate) => candidate.fd === pollFd.fd);
  if (resource?.kind !== "timer") {
    return missingPpollTimeout(
      thread,
      "ppoll one-fd timerfd proof requires a captured timerfd fd",
      {
        ...pollFd,
        resourceKind: resource?.kind,
        resourceId: resource?.id,
      },
    );
  }
  const flagRefusal = validateTimerfdFlags(thread, pollFd, resource);
  if (flagRefusal) {
    return flagRefusal;
  }
  const stateRefusal = validateTimerfdState(thread, pollFd, resource);
  return stateRefusal ?? { resource, targetResource: "synthetic-timerfd" };
}

function validateTimerfdFlags(
  thread: NativeThreadState,
  pollFd: { fd: number; events: number; revents: number },
  resource: NativeProcessResource,
): { state: "missing"; refusal: NativeProcessImageRefusal } | undefined {
  if (nativeFdAccessMode(resource.flags) !== 2) {
    return missingPpollTimeout(thread, "ppoll one-fd timerfd proof requires read/write access", {
      ...pollFd,
      resourceId: resource.id,
      resourceFlags: resource.flags,
    });
  }
  return nativeFdFlagBits(resource.flags) !== SUPPORTED_TIMERFD_FLAGS
    ? missingPpollTimeout(thread, "ppoll one-fd timerfd proof requires supported flags", {
        ...pollFd,
        resourceId: resource.id,
        resourceFlags: resource.flags,
        supportedFlags: `octal:${SUPPORTED_TIMERFD_FLAGS.toString(8)}`,
      })
    : undefined;
}

function validateTimerfdState(
  thread: NativeThreadState,
  pollFd: { fd: number; events: number; revents: number },
  resource: NativeProcessResource,
): { state: "missing"; refusal: NativeProcessImageRefusal } | undefined {
  const ticks = nativeResourceBigInt(resource, "timerfdTicks");
  if (ticks !== 0n) {
    return missingPpollTimeout(thread, "ppoll one-fd timerfd proof requires an unread timer", {
      ...pollFd,
      resourceId: resource.id,
      timerfdTicks: ticks?.toString(10),
    });
  }
  const intervalSeconds = nativeResourceBigInt(resource, "timerfdIntervalSeconds");
  const intervalNanoseconds = nativeResourceBigInt(resource, "timerfdIntervalNanoseconds");
  if (intervalSeconds !== 0n || intervalNanoseconds !== 0n) {
    return missingPpollTimeout(
      thread,
      "ppoll one-fd timerfd proof does not model periodic timers",
      {
        ...pollFd,
        resourceId: resource.id,
        timerfdIntervalSeconds: intervalSeconds?.toString(10),
        timerfdIntervalNanoseconds: intervalNanoseconds?.toString(10),
      },
    );
  }
  const settimeFlags = nativeResourceBigInt(resource, "timerfdSettimeFlags");
  return settimeFlags !== 0n
    ? missingPpollTimeout(thread, "ppoll one-fd timerfd proof does not model absolute timers", {
        ...pollFd,
        resourceId: resource.id,
        timerfdSettimeFlags: settimeFlags?.toString(10),
      })
    : undefined;
}

function nativeResourceBigInt(resource: NativeProcessResource, key: string): bigint | undefined {
  const value = resource.recipe?.[key];
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function readCapturedTimespec(
  documents: NativeProcessImageDocuments,
  sourceAddress: bigint,
): { duration: NativeSleepTimerDuration } | { refusal: true; reason: string } {
  const timespec = readCapturedMemoryRange(
    documents,
    sourceAddress,
    TIMESPEC_SIZE_BYTES,
    "sleep request timespec",
  );
  if ("refusal" in timespec) {
    return timespec;
  }
  const secondsRaw = timespec.bytes.readBigUInt64LE(0);
  const nanosecondsRaw = timespec.bytes.readBigUInt64LE(8);
  if (secondsRaw > MAX_SIGNED_I64 || nanosecondsRaw > MAX_NANOSECONDS) {
    return { refusal: true, reason: "sleep request timespec is outside supported bounds" };
  }
  return {
    duration: {
      seconds: secondsRaw.toString(10),
      nanoseconds: Number(nanosecondsRaw),
    },
  };
}

function readCapturedMemoryRange(
  documents: NativeProcessImageDocuments,
  sourceAddress: bigint,
  sizeBytes: bigint,
  label: string,
): { bytes: Buffer } | { refusal: true; reason: string } {
  const mapping = mappingContainingRange(documents, sourceAddress, sizeBytes);
  if (!mapping?.captured) {
    return { refusal: true, reason: `${label} is not in captured memory` };
  }
  const offsetInMapping = sourceAddress - BigInt(mapping.sourceStart);
  const fileOffset = BigInt(mapping.captured.offset) + offsetInMapping;
  try {
    const memory = readFileSync(join(documents.rootDir!, NATIVE_PROCESS_IMAGE_FILES.memory));
    if (fileOffset + sizeBytes > BigInt(memory.length)) {
      return { refusal: true, reason: `${label} exceeds native-memory.bin` };
    }
    return { bytes: memory.subarray(Number(fileOffset), Number(fileOffset + sizeBytes)) };
  } catch (error) {
    return {
      refusal: true,
      reason: error instanceof Error ? error.message : `${label} could not be read`,
    };
  }
}

function mappingContainingRange(
  documents: NativeProcessImageDocuments,
  sourceAddress: bigint,
  sizeBytes: bigint,
): NativeMemoryMapping | undefined {
  return documents.mappings.mappings.find(
    (mapping) =>
      mapping.permissions.read &&
      sourceAddress >= BigInt(mapping.sourceStart) &&
      sourceAddress + sizeBytes <= BigInt(mapping.sourceEnd),
  );
}

function safeNumber(value: bigint): number | undefined {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

function missingSleepTimer(
  thread: NativeThreadState,
  reason: string,
  extra?: Record<string, unknown>,
): { state: "missing"; refusal: NativeProcessImageRefusal } {
  return { state: "missing", refusal: missingSleepTimerRefusal(thread, reason, extra) };
}

function missingPpollTimeout(
  thread: NativeThreadState,
  reason: string,
  extra?: Record<string, unknown>,
): { state: "missing"; refusal: NativeProcessImageRefusal } {
  return { state: "missing", refusal: missingPpollTimeoutRefusal(thread, reason, extra) };
}

function missingSleepTimerRefusal(
  thread: NativeThreadState,
  reason: string,
  extra?: Record<string, unknown>,
): NativeProcessImageRefusal {
  return {
    code: "target-sleep-remaining-time-missing",
    message: `thread ${thread.id} sleep/timer syscall remaining time is not modeled`,
    detail: detail(thread, "sleep-timer", {
      reason,
      requiredModel: ["relative sleep request timespec", "target timer rearm duration"],
      ...extra,
    }),
  };
}

function missingPpollTimeoutRefusal(
  thread: NativeThreadState,
  reason: string,
  extra?: Record<string, unknown>,
): NativeProcessImageRefusal {
  return {
    code: "target-ppoll-timeout-missing",
    message: `thread ${thread.id} ppoll timeout state is not modeled`,
    detail: detail(thread, "poll-timeout", {
      reason,
      requiredModel: ["zero-fd ppoll", "relative timeout timespec", "null signal mask"],
      ...extra,
    }),
  };
}

function decodedPpollDetail(decoded: { timeoutPointer: bigint; sigsetSize: bigint }) {
  return { timeoutPointer: hex(decoded.timeoutPointer), sigsetSize: hex(decoded.sigsetSize) };
}

function syscallName(thread: NativeThreadState): string {
  return thread.syscall.name ?? "unknown";
}

function detail(
  thread: NativeThreadState,
  syscallClass: NativeActiveSyscallClass,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    threadId: thread.id,
    syscallClass,
    syscall: thread.syscall,
    ...extra,
  };
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
