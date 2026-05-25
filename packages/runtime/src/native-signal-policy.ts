import type { NativeProcessImageRefusal, NativeThreadState } from "./native-process-image.ts";

export type NativeSignalBlockedMaskPolicy = "require-empty" | "restore-safe-mask";

export interface NativeSignalRestorePolicyRequest {
  thread: NativeThreadState;
  blockedMaskPolicy?: NativeSignalBlockedMaskPolicy;
}

export type NativeSignalRestorePolicyResult =
  | {
      state: "accepted";
      threadId: string;
      blockedMaskPolicy: NativeSignalBlockedMaskPolicy;
      targetBlockedMasks: string[];
      refusals: [];
    }
  | {
      state: "refused";
      threadId: string;
      refusals: NativeProcessImageRefusal[];
    };

export function planNativeSignalRestorePolicy(
  request: NativeSignalRestorePolicyRequest,
): NativeSignalRestorePolicyResult {
  const blockedMaskPolicy = request.blockedMaskPolicy ?? "require-empty";
  const refusals = signalRefusals(request.thread, blockedMaskPolicy);
  return refusals.length === 0
    ? {
        state: "accepted",
        threadId: request.thread.id,
        blockedMaskPolicy,
        targetBlockedMasks: normalizedMasks(request.thread.signal.blocked),
        refusals: [],
      }
    : { state: "refused", threadId: request.thread.id, refusals };
}

export function safeSignalRestoreRefusal(
  request: NativeSignalRestorePolicyRequest,
): NativeProcessImageRefusal | undefined {
  return planNativeSignalRestorePolicy(request).refusals[0];
}

function signalRefusals(
  thread: NativeThreadState,
  blockedMaskPolicy: NativeSignalBlockedMaskPolicy,
): NativeProcessImageRefusal[] {
  return [
    activeSignalFrameRefusal(thread),
    pendingSignalRefusal(thread),
    altStackRefusal(thread),
    malformedMaskRefusal(thread, "blocked", thread.signal.blocked),
    malformedMaskRefusal(thread, "pending", thread.signal.pending),
    blockedMaskRefusal(thread, blockedMaskPolicy),
  ].flatMap((refusal) => (refusal ? [refusal] : []));
}

function activeSignalFrameRefusal(
  thread: NativeThreadState,
): NativeProcessImageRefusal | undefined {
  return thread.signal.activeFrame
    ? signalRefusal("signal-frame-active", thread, "is inside a signal frame", {
        activeFrame: true,
        requiredModel: [
          "signal trampoline frame",
          "siginfo ownership",
          "target signal return path",
        ],
      })
    : undefined;
}

function pendingSignalRefusal(thread: NativeThreadState): NativeProcessImageRefusal | undefined {
  return hasNonZeroMask(thread.signal.pending)
    ? signalRefusal("signal-state-unsupported", thread, "has pending signal state", {
        pendingMasks: normalizedMasks(thread.signal.pending),
        requiredModel: [
          "pending per-thread/process signal queues",
          "siginfo ownership",
          "delivery ordering",
        ],
      })
    : undefined;
}

function altStackRefusal(thread: NativeThreadState): NativeProcessImageRefusal | undefined {
  return thread.signal.altStack.state !== "disabled"
    ? signalRefusal("signal-state-unsupported", thread, "has active alt-stack state", {
        altStack: thread.signal.altStack,
        requiredModel: ["target alt-stack allocation", "active signal-frame ownership"],
      })
    : undefined;
}

function malformedMaskRefusal(
  thread: NativeThreadState,
  kind: "blocked" | "pending",
  masks: string[],
): NativeProcessImageRefusal | undefined {
  return masks.some((mask) => normalizeMask(mask) === undefined)
    ? signalRefusal("signal-state-unsupported", thread, `has malformed ${kind} signal mask`, {
        maskKind: kind,
        masks,
        requiredModel: ["well-formed signal mask"],
      })
    : undefined;
}

function blockedMaskRefusal(
  thread: NativeThreadState,
  policy: NativeSignalBlockedMaskPolicy,
): NativeProcessImageRefusal | undefined {
  return policy === "require-empty" && hasNonZeroMask(thread.signal.blocked)
    ? signalRefusal("signal-state-unsupported", thread, "has blocked signal state", {
        blockedMasks: normalizedMasks(thread.signal.blocked),
        policy,
        requiredModel: ["explicit blocked-mask restore policy"],
      })
    : undefined;
}

function normalizedMasks(masks: string[]): string[] {
  return masks.map((mask) => normalizeMask(mask) ?? mask);
}

function hasNonZeroMask(masks: string[]): boolean {
  return normalizedMasks(masks).some((mask) => !/^0x0+$/.test(mask));
}

function normalizeMask(mask: string): string | undefined {
  const normalized = mask.trim().toLowerCase().replace(/^0x/, "");
  if (normalized.length === 0 || !/^[0-9a-f]+$/.test(normalized)) {
    return undefined;
  }
  return `0x${normalized.replace(/^0+/, "") || "0"}`;
}

function signalRefusal(
  code: NativeProcessImageRefusal["code"],
  thread: NativeThreadState,
  message: string,
  detail: Record<string, unknown> = {},
): NativeProcessImageRefusal {
  return {
    code,
    message: `thread ${thread.id} ${message}`,
    detail: { threadId: thread.id, ...detail },
  };
}
