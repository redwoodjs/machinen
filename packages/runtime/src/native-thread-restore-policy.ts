import {
  classifyNativeThreadSyscall,
  type NativeActiveSyscallContinuation,
  type NativeActiveSyscallPolicyOptions,
} from "./native-active-syscall-policy.ts";
import { normalizeNativeHex } from "./native-hex.ts";
import { safeSimdFpuRefusal } from "./native-simd-fpu-policy.ts";
import {
  safeTlsSegmentBaseRefusal,
  type NativeTlsTargetAccessPolicy,
} from "./native-tls-segment-policy.ts";
import {
  nativeThreadRefusal,
  unsafeNativeThreadExecutionState,
} from "./native-thread-state-policy.ts";
import type {
  NativeMemoryMapping,
  NativeProcessImageRefusal,
  NativeProcessResource,
  NativeThreadState,
} from "./native-process-image.ts";

export type NativeThreadRestorePlan =
  | {
      state: "accepted";
      threadId: string;
      targetThreadCount: 1;
      activeSyscallContinuations: NativeActiveSyscallContinuation[];
      refusals: [];
    }
  | {
      state: "refused";
      targetThreadCount: number;
      refusals: NativeProcessImageRefusal[];
    };

export interface NativeThreadRestorePlanRequest {
  threads: NativeThreadState[];
  mappings?: NativeMemoryMapping[];
  resources?: NativeProcessResource[];
  tls?: {
    targetFsBase?: string;
    targetGsBase?: string;
    targetAccessPolicy?: NativeTlsTargetAccessPolicy;
  };
  activeSyscall?: NativeActiveSyscallPolicyOptions;
}

export function planNativeThreadRestoreBoundary(
  request: NativeThreadRestorePlanRequest,
): NativeThreadRestorePlan {
  const countRefusal = singleThreadRefusal(request.threads);
  if (countRefusal) {
    return refused(request.threads.length, [countRefusal]);
  }

  const thread = request.threads[0]!;
  const activeSyscall = planModeledActiveSyscall(thread, request.activeSyscall);
  const refusals = [
    thread.refusal,
    safeStoppedThreadRefusal(thread),
    activeSyscall.refusal,
    unsafeNativeThreadExecutionState(thread, {
      allowModeledActiveSyscall:
        activeSyscall.continuation !== undefined || activeSyscall.refusal !== undefined,
    }),
    safeTlsRefusal(thread, request.tls),
    safeRegisterRefusal(thread),
    safeSimdFpuRefusal(thread),
    safeStackRefusal(thread, request.mappings ?? []),
    ...resourceRefusals(request.resources ?? []),
  ].filter((entry) => entry !== undefined);

  return refusals.length > 0
    ? refused(request.threads.length, refusals)
    : {
        state: "accepted",
        threadId: thread.id,
        targetThreadCount: 1,
        activeSyscallContinuations: activeSyscall.continuation ? [activeSyscall.continuation] : [],
        refusals: [],
      };
}

function planModeledActiveSyscall(
  thread: NativeThreadState,
  options: NativeActiveSyscallPolicyOptions | undefined,
): { continuation?: NativeActiveSyscallContinuation; refusal?: NativeProcessImageRefusal } {
  if (thread.syscall.state === "outside-syscall") {
    return {};
  }
  const classification = classifyNativeThreadSyscall(thread, options ?? {});
  return classification.continuation
    ? { continuation: classification.continuation }
    : { refusal: classification.refusal };
}

function singleThreadRefusal(threads: NativeThreadState[]): NativeProcessImageRefusal | undefined {
  return threads.length === 1
    ? undefined
    : refusal("thread-state-unsupported", "portable restore currently accepts exactly one thread");
}

function safeStoppedThreadRefusal(
  thread: NativeThreadState,
): NativeProcessImageRefusal | undefined {
  if (thread.state !== "stopped") {
    return refusal("thread-state-unsupported", `thread ${thread.id} is not stopped`);
  }
  if (thread.stopReason === "signal-delivery-stop") {
    return refusal("signal-state-unsupported", `thread ${thread.id} is in signal delivery stop`);
  }
  if (thread.stopReason !== "ptrace-stop") {
    return refusal("thread-state-unsupported", `thread ${thread.id} stop reason is unsupported`);
  }
  return undefined;
}

function safeTlsRefusal(
  thread: NativeThreadState,
  tls: NativeThreadRestorePlanRequest["tls"],
): NativeProcessImageRefusal | undefined {
  return safeTlsSegmentBaseRefusal({
    thread,
    targetFsBase: tls?.targetFsBase,
    targetGsBase: tls?.targetGsBase,
    targetAccessPolicy: tls?.targetAccessPolicy,
  });
}

function safeRegisterRefusal(thread: NativeThreadState): NativeProcessImageRefusal | undefined {
  if (thread.sourceRegisters.arch !== "arm64") {
    return refusal("architecture-unsupported", `thread ${thread.id} registers are not arm64`);
  }
  if (!isKnownHex(thread.sourceRegisters.pc) || !isKnownHex(thread.sourceRegisters.sp)) {
    return refusal("thread-state-unsupported", `thread ${thread.id} register state is ambiguous`);
  }
  return undefined;
}

function safeStackRefusal(
  thread: NativeThreadState,
  mappings: NativeMemoryMapping[],
): NativeProcessImageRefusal | undefined {
  const mapping = mappings.find((candidate) => candidate.id === thread.stackMapping);
  if (!mapping) {
    return refusal("thread-state-unsupported", `thread ${thread.id} stack mapping is missing`);
  }
  if (mapping.permissions.shared || mapping.kind === "shared") {
    return refusal("mapping-shared-unsupported", `thread ${thread.id} stack mapping is shared`);
  }
  return undefined;
}

function resourceRefusals(resources: NativeProcessResource[]): NativeProcessImageRefusal[] {
  return resources.flatMap((resource) => resourceRefusal(resource));
}

function resourceRefusal(resource: NativeProcessResource): NativeProcessImageRefusal[] {
  if (resource.kind === "unknown" && resource.refusal) {
    return [resource.refusal];
  }
  if (resource.kind === "futex") {
    return [refusal("futex-state-unsupported", `resource ${resource.id} has futex wait state`)];
  }
  if (resource.kind === "unknown") {
    return [refusal("resource-kind-unsupported", `resource ${resource.id} is unknown`)];
  }
  return [];
}

function isKnownHex(value: string | undefined): boolean {
  if (!value || value.toLowerCase() === "unknown") {
    return false;
  }
  try {
    normalizeNativeHex(value);
    return true;
  } catch {
    return false;
  }
}

function refused(
  targetThreadCount: number,
  refusals: NativeProcessImageRefusal[],
): NativeThreadRestorePlan {
  return { state: "refused", targetThreadCount, refusals };
}

const refusal = nativeThreadRefusal;
