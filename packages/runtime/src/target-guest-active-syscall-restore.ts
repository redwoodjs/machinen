import type {
  NativeActiveSyscallClassificationResult,
  NativeActiveSyscallContinuation,
  NativeModeledPpollTargetResource,
} from "./native-active-syscall-policy.ts";
import type { NativeProcessImageRefusal } from "./native-process-image.ts";

export type TargetGuestActiveSyscallRestoreStep =
  | {
      action: "rearm-sleep-timer";
      threadId: string;
      syscallName: string;
      remainingTime: { seconds: string; nanoseconds: number };
      resumeMode: "defer-target-resume";
    }
  | {
      action: "rearm-ppoll-timeout";
      threadId: string;
      remainingTime: { seconds: string; nanoseconds: number };
      nfds: 0 | 1;
      resources: NativeModeledPpollTargetResource[];
      resumeMode: "defer-target-resume";
    };

export type TargetGuestActiveSyscallRestorePlan =
  | {
      state: "planned";
      steps: TargetGuestActiveSyscallRestoreStep[];
      refusals: [];
    }
  | {
      state: "refused";
      steps: [];
      refusals: NativeProcessImageRefusal[];
    };

export function planTargetGuestActiveSyscallRestore(
  classification: NativeActiveSyscallClassificationResult,
): TargetGuestActiveSyscallRestorePlan {
  if (classification.refusals.length > 0) {
    return { state: "refused", steps: [], refusals: classification.refusals };
  }
  return {
    state: "planned",
    steps: classification.continuations.map((continuation) => continuationStep(continuation)),
    refusals: [],
  };
}

function continuationStep(
  continuation: NativeActiveSyscallContinuation,
): TargetGuestActiveSyscallRestoreStep {
  if (continuation.syscallClass === "sleep-timer") {
    return {
      action: "rearm-sleep-timer",
      threadId: continuation.threadId,
      syscallName: continuation.metadata.sleepTimer.syscallName,
      remainingTime: duration(continuation.metadata.remainingTime),
      resumeMode: "defer-target-resume",
    };
  }
  return {
    action: "rearm-ppoll-timeout",
    threadId: continuation.threadId,
    remainingTime: duration(continuation.metadata.remainingTime),
    nfds: continuation.metadata.ppollTimeout.nfds,
    resources: (continuation.metadata.ppollTimeout.pollFds ?? []).map((fd) => fd.targetResource),
    resumeMode: "defer-target-resume",
  };
}

function duration(durationLike: { seconds: string; nanoseconds: number }): {
  seconds: string;
  nanoseconds: number;
} {
  return { seconds: durationLike.seconds, nanoseconds: durationLike.nanoseconds };
}
