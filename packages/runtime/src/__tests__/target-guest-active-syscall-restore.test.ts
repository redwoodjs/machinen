import { describe, expect, it } from "vitest";
import type { NativeActiveSyscallClassificationResult } from "../native-active-syscall-policy.ts";
import { planTargetGuestActiveSyscallRestore } from "../target-guest-active-syscall-restore.ts";

const sleepResult: NativeActiveSyscallClassificationResult = {
  classifications: [],
  refusals: [],
  continuations: [
    {
      threadId: "thread:1",
      syscallClass: "sleep-timer",
      action: "defer-target-resume",
      syscall: { state: "inside-syscall", name: "clock_nanosleep" },
      metadata: {
        remainingTime: {
          state: "modeled",
          kind: "relative-duration",
          source: "active-syscall-request-timespec",
          precision: "requested-duration-upper-bound",
          seconds: "2",
          nanoseconds: 125,
        },
        sleepTimer: {
          kind: "relative-duration",
          syscallName: "clock_nanosleep",
          argumentSource: "registers",
          requestPointer: "0x6000",
          requestedTime: { seconds: "2", nanoseconds: 125 },
          remainingTime: {
            state: "modeled",
            kind: "relative-duration",
            source: "active-syscall-request-timespec",
            precision: "requested-duration-upper-bound",
            seconds: "2",
            nanoseconds: 125,
          },
        },
        policy: "conservative-target-timer-rearm-required",
      },
    },
  ],
};

const ppollResult: NativeActiveSyscallClassificationResult = {
  classifications: [],
  refusals: [],
  continuations: [
    {
      threadId: "thread:2",
      syscallClass: "poll-timeout",
      action: "defer-target-resume",
      syscall: { state: "inside-syscall", name: "ppoll" },
      metadata: {
        remainingTime: {
          state: "modeled",
          kind: "relative-duration",
          source: "active-syscall-ppoll-timeout",
          precision: "requested-duration-upper-bound",
          seconds: "0",
          nanoseconds: 5000000,
        },
        ppollTimeout: {
          kind: "relative-duration",
          syscallName: "ppoll",
          argumentSource: "registers",
          fdsPointer: "0x6100",
          nfds: 1,
          pollFds: [
            {
              fd: 3,
              events: 1,
              revents: 0,
              sourceAddress: "0x6100",
              targetResource: "synthetic-empty-eventfd",
            },
          ],
          timeoutPointer: "0x6200",
          sigmaskPointer: "0x0",
          requestedTime: { seconds: "0", nanoseconds: 5000000 },
          remainingTime: {
            state: "modeled",
            kind: "relative-duration",
            source: "active-syscall-ppoll-timeout",
            precision: "requested-duration-upper-bound",
            seconds: "0",
            nanoseconds: 5000000,
          },
        },
        policy: "conservative-target-ppoll-timeout-rearm-required",
      },
    },
  ],
};

describe("target guest active syscall restore", () => {
  it("plans target re-arm for modeled sleep timers", () => {
    expect(planTargetGuestActiveSyscallRestore(sleepResult)).toEqual({
      state: "planned",
      refusals: [],
      steps: [
        {
          action: "rearm-sleep-timer",
          threadId: "thread:1",
          syscallName: "clock_nanosleep",
          remainingTime: { seconds: "2", nanoseconds: 125 },
          resumeMode: "defer-target-resume",
        },
      ],
    });
  });

  it("plans target re-arm for modeled ppoll timeouts", () => {
    expect(planTargetGuestActiveSyscallRestore(ppollResult)).toEqual({
      state: "planned",
      refusals: [],
      steps: [
        {
          action: "rearm-ppoll-timeout",
          threadId: "thread:2",
          remainingTime: { seconds: "0", nanoseconds: 5000000 },
          nfds: 1,
          resources: ["synthetic-empty-eventfd"],
          resumeMode: "defer-target-resume",
        },
      ],
    });
  });

  it("refuses target re-arm when active syscall classification refused", () => {
    expect(
      planTargetGuestActiveSyscallRestore({
        classifications: [],
        continuations: [],
        refusals: [
          { code: "blocking-syscall-state-unsupported", message: "thread blocked in read" },
        ],
      }),
    ).toEqual({
      state: "refused",
      steps: [],
      refusals: [{ code: "blocking-syscall-state-unsupported", message: "thread blocked in read" }],
    });
  });
});
