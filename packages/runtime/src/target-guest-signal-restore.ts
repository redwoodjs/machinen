import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type { NativeSignalRestorePolicyResult } from "./native-signal-policy.ts";

export type TargetGuestSignalRestoreStep =
  | { action: "save-loader-signal-mask"; threadId: string }
  | { action: "sigprocmask-set-blocked"; threadId: string; targetBlockedMasks: string[] }
  | { action: "verify-blocked-signal-mask"; threadId: string; targetBlockedMasks: string[] }
  | { action: "restore-loader-signal-mask"; threadId: string };

export type TargetGuestSignalRestorePlan =
  | {
      state: "planned";
      threadId: string;
      targetBlockedMasks: string[];
      steps: TargetGuestSignalRestoreStep[];
      refusals: [];
    }
  | {
      state: "refused";
      threadId: string;
      refusals: NativeProcessImageRefusal[];
    };

export function planTargetGuestSignalRestore(
  policy: NativeSignalRestorePolicyResult,
): TargetGuestSignalRestorePlan {
  if (policy.state === "refused") {
    return { state: "refused", threadId: policy.threadId, refusals: policy.refusals };
  }
  const targetBlockedMasks = canonicalMasks(policy.targetBlockedMasks);
  return {
    state: "planned",
    threadId: policy.threadId,
    targetBlockedMasks,
    steps: [
      { action: "save-loader-signal-mask", threadId: policy.threadId },
      { action: "sigprocmask-set-blocked", threadId: policy.threadId, targetBlockedMasks },
      { action: "verify-blocked-signal-mask", threadId: policy.threadId, targetBlockedMasks },
      { action: "restore-loader-signal-mask", threadId: policy.threadId },
    ],
    refusals: [],
  };
}

function canonicalMasks(masks: string[]): string[] {
  return masks.map((mask) => `0x${BigInt(mask).toString(16)}`);
}
