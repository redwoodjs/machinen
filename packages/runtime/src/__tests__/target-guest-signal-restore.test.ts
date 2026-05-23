import { describe, expect, it } from "vitest";
import { planNativeSignalRestorePolicy } from "../native-signal-policy.ts";
import { planTargetGuestSignalRestore } from "../target-guest-signal-restore.ts";
import type { NativeThreadState } from "../native-process-image.ts";

function thread(blocked: string[] = ["0x0"]): NativeThreadState {
  return {
    id: "thread:1",
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: "mapping:stack",
    sourceRegisters: { arch: "arm64", pc: "0x400000", sp: "0x700000000000", pstate: "0x0", x: [] },
    tls: { threadPointer: "0x710000000000", rseq: { state: "absent" } },
    simdFpu: { state: "not-live" },
    syscall: { state: "outside-syscall" },
    signal: {
      blocked,
      pending: ["0x0"],
      activeFrame: false,
      altStack: { state: "disabled" },
    },
  };
}

describe("target guest signal restore", () => {
  it("plans save/apply/verify/restore for an empty blocked mask", () => {
    const policy = planNativeSignalRestorePolicy({ thread: thread() });

    expect(planTargetGuestSignalRestore(policy)).toEqual({
      state: "planned",
      threadId: "thread:1",
      targetBlockedMasks: ["0x0"],
      refusals: [],
      steps: [
        { action: "save-loader-signal-mask", threadId: "thread:1" },
        { action: "sigprocmask-set-blocked", threadId: "thread:1", targetBlockedMasks: ["0x0"] },
        { action: "verify-blocked-signal-mask", threadId: "thread:1", targetBlockedMasks: ["0x0"] },
        { action: "restore-loader-signal-mask", threadId: "thread:1" },
      ],
    });
  });

  it("plans safe non-empty mask handoff when policy accepts it", () => {
    const policy = planNativeSignalRestorePolicy({
      thread: thread(["0x0000000000000002"]),
      blockedMaskPolicy: "restore-safe-mask",
    });

    expect(planTargetGuestSignalRestore(policy)).toMatchObject({
      state: "planned",
      targetBlockedMasks: ["0x2"],
      steps: [
        expect.objectContaining({ action: "save-loader-signal-mask" }),
        expect.objectContaining({ action: "sigprocmask-set-blocked", targetBlockedMasks: ["0x2"] }),
        expect.objectContaining({
          action: "verify-blocked-signal-mask",
          targetBlockedMasks: ["0x2"],
        }),
        expect.objectContaining({ action: "restore-loader-signal-mask" }),
      ],
    });
  });

  it("refuses target handoff for refused signal policies", () => {
    const policy = planNativeSignalRestorePolicy({ thread: thread(["0x2"]) });

    expect(planTargetGuestSignalRestore(policy)).toMatchObject({
      state: "refused",
      threadId: "thread:1",
      refusals: [expect.objectContaining({ code: "signal-state-unsupported" })],
    });
  });
});
