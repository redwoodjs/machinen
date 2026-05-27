import type {
  NativeActiveSyscallClassificationResult,
  NativeActiveSyscallContinuation,
  NativeModeledFdReadTargetResource,
  NativeModeledPingSocketRecvmsgState,
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
    }
  | {
      action: "restore-fd-read-block";
      threadId: string;
      fd: number;
      countBytes: number;
      resource: Exclude<NativeModeledFdReadTargetResource, "reopened-offset-file">;
      remainingTime?: { seconds: string; nanoseconds: number };
      resumeMode: "defer-target-resume";
    }
  | {
      action: "complete-fd-read-from-file";
      threadId: string;
      fd: number;
      countBytes: number;
      targetBufferPointer: string;
      fileOffset: number;
      resumeMode: "defer-target-resume";
    }
  | {
      action: "complete-fd-write-to-file";
      threadId: string;
      fd: number;
      countBytes: number;
      targetBufferPointer: string;
      fileOffset: number;
      resumeMode: "defer-target-resume";
    }
  | {
      action: "restore-ping-socket-recvmsg-wait";
      threadId: string;
      fd: number;
      sourceFd: number;
      messagePointer: string;
      iovLengthBytes: number;
      controlLengthBytes: number;
      receiveQueue: NativeModeledPingSocketRecvmsgState["receiveQueue"];
      inFlightPackets: NativeModeledPingSocketRecvmsgState["inFlightPackets"];
      signalTimer: NativeModeledPingSocketRecvmsgState["signalTimer"];
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

// fallow-ignore-next-line complexity
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
  if (continuation.syscallClass === "fd-blocking" && "fdWrite" in continuation.metadata) {
    const write = continuation.metadata.fdWrite;
    return {
      action: "complete-fd-write-to-file",
      threadId: continuation.threadId,
      fd: write.fd,
      countBytes: write.countBytes,
      targetBufferPointer: write.targetBufferPointer,
      fileOffset: write.fileOffset,
      resumeMode: "defer-target-resume",
    };
  }
  if (continuation.syscallClass === "fd-blocking" && "pingSocketRecvmsg" in continuation.metadata) {
    const recvmsg = continuation.metadata.pingSocketRecvmsg;
    return {
      action: "restore-ping-socket-recvmsg-wait",
      threadId: continuation.threadId,
      fd: recvmsg.targetFd,
      sourceFd: recvmsg.sourceFd,
      messagePointer: recvmsg.messagePointer,
      iovLengthBytes: recvmsg.iovLengthBytes,
      controlLengthBytes: recvmsg.controlLengthBytes,
      receiveQueue: recvmsg.receiveQueue,
      inFlightPackets: recvmsg.inFlightPackets,
      signalTimer: recvmsg.signalTimer,
      resumeMode: "defer-target-resume",
    };
  }
  if (continuation.syscallClass === "fd-blocking" && "fdRead" in continuation.metadata) {
    const read = continuation.metadata.fdRead;
    if (read.targetResource === "reopened-offset-file") {
      return {
        action: "complete-fd-read-from-file",
        threadId: continuation.threadId,
        fd: read.fd,
        countBytes: read.countBytes,
        targetBufferPointer: read.targetBufferPointer!,
        fileOffset: read.fileOffset!,
        resumeMode: "defer-target-resume",
      };
    }
    return {
      action: "restore-fd-read-block",
      threadId: continuation.threadId,
      fd: read.fd,
      countBytes: read.countBytes,
      resource: read.targetResource,
      remainingTime: read.remainingTime ? duration(read.remainingTime) : undefined,
      resumeMode: "defer-target-resume",
    };
  }
  if (continuation.syscallClass === "poll-timeout") {
    return {
      action: "rearm-ppoll-timeout",
      threadId: continuation.threadId,
      remainingTime: duration(continuation.metadata.remainingTime),
      nfds: continuation.metadata.ppollTimeout.nfds,
      resources: (continuation.metadata.ppollTimeout.pollFds ?? []).map((fd) => fd.targetResource),
      resumeMode: "defer-target-resume",
    };
  }
  throw new Error("unsupported active syscall continuation");
}

function duration(durationLike: { seconds: string; nanoseconds: number }): {
  seconds: string;
  nanoseconds: number;
} {
  return { seconds: durationLike.seconds, nanoseconds: durationLike.nanoseconds };
}
