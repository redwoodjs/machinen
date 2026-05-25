import type { NativeProcessImageRefusal, NativeThreadState } from "./native-process-image.ts";

interface NativeThreadExecutionStateOptions {
  allowModeledActiveSyscall?: boolean;
  allowBlockedSignalMask?: boolean;
}

export function unsafeNativeThreadExecutionState(
  thread: NativeThreadState,
  options: NativeThreadExecutionStateOptions = {},
): NativeProcessImageRefusal | undefined {
  if (thread.syscall.state !== "outside-syscall" && !options.allowModeledActiveSyscall) {
    return nativeThreadRefusal("active-syscall", `thread ${thread.id} is ${thread.syscall.state}`);
  }
  if (thread.signal.activeFrame) {
    return nativeThreadRefusal(
      "signal-frame-active",
      `thread ${thread.id} is inside a signal frame`,
    );
  }
  if (hasNonZeroNativeSignalMask(thread.signal.pending)) {
    return nativeThreadRefusal(
      "signal-state-unsupported",
      `thread ${thread.id} has pending signal state`,
    );
  }
  if (hasNonZeroNativeSignalMask(thread.signal.blocked) && !options.allowBlockedSignalMask) {
    return nativeThreadRefusal(
      "signal-state-unsupported",
      `thread ${thread.id} has blocked signal state`,
    );
  }
  if (thread.signal.altStack.state !== "disabled") {
    return nativeThreadRefusal(
      "signal-state-unsupported",
      `thread ${thread.id} has active alt-stack state`,
    );
  }
  if (thread.tls.rseq.state !== "absent") {
    return nativeThreadRefusal("rseq-state-unsupported", `thread ${thread.id} has rseq state`, {
      threadId: thread.id,
      rseq: thread.tls.rseq,
      requiredModel: [
        "target rseq registration lifecycle",
        "critical-section abort IP translation",
        "per-thread TLS rseq area ownership",
      ],
    });
  }
  return undefined;
}

function hasNonZeroNativeSignalMask(masks: string[]): boolean {
  return masks.some((mask) => {
    const normalized = mask.trim().toLowerCase().replace(/^0x/, "");
    return normalized.length > 0 && !/^0+$/.test(normalized);
  });
}

export function nativeThreadRefusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
  detail?: Record<string, unknown>,
): NativeProcessImageRefusal {
  return detail ? { code, message, detail } : { code, message };
}
