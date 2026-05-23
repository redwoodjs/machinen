import { describe, expect, it } from "vitest";
import { planTargetGuestTwoThreadRestore } from "../target-guest-two-thread-restore.ts";
import type { NativeControlledTwoThreadRestorePlan } from "../native-two-thread-boundary.ts";

const boundary: NativeControlledTwoThreadRestorePlan = {
  state: "accepted",
  targetThreadCount: 2,
  threadIds: ["thread:1", "thread:2"],
  threadPlans: [
    {
      state: "accepted",
      threadId: "thread:1",
      targetThreadCount: 1,
      activeSyscallContinuations: [],
      signalRestore: { blockedMasks: ["0x0"] },
      refusals: [],
    },
    {
      state: "accepted",
      threadId: "thread:2",
      targetThreadCount: 1,
      activeSyscallContinuations: [],
      signalRestore: { blockedMasks: ["0x0"] },
      refusals: [],
    },
  ],
  refusals: [],
};

const bindings = [
  {
    threadId: "thread:1",
    stackBase: "0x500000000000",
    stackLimit: "0x500000001000",
    registers: { rip: "0x700300000316", rsp: "0x500000000f00", rbp: "0x500000000f80" },
  },
  {
    threadId: "thread:2",
    stackBase: "0x500000010000",
    stackLimit: "0x500000011000",
    registers: { rip: "0x700300000516", rsp: "0x500000010f00", rbp: "0x500000010f80" },
  },
];

describe("target guest two-thread restore", () => {
  it("plans two independent target thread spawns", () => {
    expect(planTargetGuestTwoThreadRestore(boundary, bindings)).toEqual({
      state: "planned",
      targetThreadCount: 2,
      refusals: [],
      steps: [
        {
          action: "spawn-target-thread",
          threadId: "thread:1",
          stackBase: "0x500000000000",
          stackLimit: "0x500000001000",
          registers: { rip: "0x700300000316", rsp: "0x500000000f00", rbp: "0x500000000f80" },
        },
        {
          action: "spawn-target-thread",
          threadId: "thread:2",
          stackBase: "0x500000010000",
          stackLimit: "0x500000011000",
          registers: { rip: "0x700300000516", rsp: "0x500000010f00", rbp: "0x500000010f80" },
        },
      ],
    });
  });

  it("refuses overlapping target stacks", () => {
    expect(
      planTargetGuestTwoThreadRestore(boundary, [
        bindings[0]!,
        { ...bindings[1]!, stackBase: "0x500000000800", stackLimit: "0x500000001800" },
      ]),
    ).toMatchObject({
      state: "refused",
      refusals: [expect.objectContaining({ code: "target-stack-window-unsupported" })],
    });
  });

  it("propagates refused controlled-boundary plans", () => {
    expect(
      planTargetGuestTwoThreadRestore(
        {
          state: "refused",
          targetThreadCount: 2,
          refusals: [{ code: "futex-state-unsupported", message: "resource has futex wait" }],
        },
        bindings,
      ),
    ).toEqual({
      state: "refused",
      targetThreadCount: 2,
      steps: [],
      refusals: [{ code: "futex-state-unsupported", message: "resource has futex wait" }],
    });
  });
});
