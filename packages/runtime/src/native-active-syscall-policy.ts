/** Active native syscall classification for actual real-utility attempts. */

import type { NativeProcessImageRefusal, NativeThreadState } from "./native-process-image.ts";

export type NativeActiveSyscallClass =
  | "outside-syscall"
  | "sleep-timer"
  | "fd-blocking"
  | "restart"
  | "unknown-active";

export interface NativeActiveSyscallClassification {
  threadId: string;
  state: NativeThreadState["syscall"]["state"];
  syscallNumber?: number;
  syscallName?: string;
  class: NativeActiveSyscallClass;
  resumable: false;
  refusal?: NativeProcessImageRefusal;
}

export interface NativeActiveSyscallClassificationResult {
  classifications: NativeActiveSyscallClassification[];
  refusals: NativeProcessImageRefusal[];
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

export function classifyNativeActiveSyscalls(
  threads: NativeThreadState[],
): NativeActiveSyscallClassificationResult {
  const classifications = threads.map(classifyNativeThreadSyscall);
  return {
    classifications,
    refusals: classifications.flatMap((classification) =>
      classification.refusal ? [classification.refusal] : [],
    ),
  };
}

export function classifyNativeThreadSyscall(
  thread: NativeThreadState,
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
    return refusedClassification(thread, "sleep-timer", {
      code: "blocking-syscall-state-unsupported",
      message: `thread ${thread.id} is blocked in sleep/timer syscall ${name}`,
      detail: detail(thread, "sleep-timer", {
        requiredModel: ["remaining time", "restart/result contract", "target timer rearm policy"],
      }),
    });
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
