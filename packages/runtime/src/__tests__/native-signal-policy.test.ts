import { describe, expect, it } from "vitest";
import { planNativeSignalRestorePolicy } from "../native-signal-policy.ts";
import type { NativeThreadState } from "../native-process-image.ts";

function thread(): NativeThreadState {
  return {
    id: "thread:signal",
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: "mapping:stack",
    sourceRegisters: {
      arch: "arm64",
      pc: "0x400120",
      sp: "0x700000000f00",
      pstate: "0x0",
      x: Array.from({ length: 31 }, () => "0x0"),
    },
    syscall: { state: "outside-syscall" },
    signal: {
      blocked: ["0x0"],
      pending: ["0x0"],
      activeFrame: false,
      altStack: { state: "disabled" },
    },
    tls: { threadPointer: "0x0", sourceRegister: "arm64-tpidr-el0", rseq: { state: "absent" } },
    simdFpu: { state: "not-live", provenance: "unit-test-zero-fpstate" },
  };
}

describe("native signal restore policy", () => {
  it("accepts empty masks by default", () => {
    expect(planNativeSignalRestorePolicy({ thread: thread() })).toMatchObject({
      state: "accepted",
      blockedMaskPolicy: "require-empty",
      targetBlockedMasks: ["0x0"],
    });
  });

  it("accepts a safe blocked mask only under the opt-in restore policy", () => {
    const candidate = thread();
    candidate.signal.blocked = ["0x2"];

    expect(planNativeSignalRestorePolicy({ thread: candidate })).toMatchObject({
      state: "refused",
      refusals: [expect.objectContaining({ code: "signal-state-unsupported" })],
    });
    expect(
      planNativeSignalRestorePolicy({
        thread: candidate,
        blockedMaskPolicy: "restore-safe-mask",
      }),
    ).toMatchObject({ state: "accepted", targetBlockedMasks: ["0x2"] });
  });

  it("refuses pending signals, active signal frames, altstack, and malformed masks", () => {
    const cases: Array<{
      name: string;
      mutate: (candidate: NativeThreadState) => void;
      detail: Record<string, unknown>;
    }> = [
      {
        name: "pending",
        mutate: (candidate) => (candidate.signal.pending = ["0x1"]),
        detail: {
          pendingMasks: ["0x1"],
          requiredModel: expect.arrayContaining(["siginfo ownership", "delivery ordering"]),
        },
      },
      {
        name: "active-frame",
        mutate: (candidate) => (candidate.signal.activeFrame = true),
        detail: {
          activeFrame: true,
          requiredModel: expect.arrayContaining(["signal trampoline frame"]),
        },
      },
      {
        name: "altstack",
        mutate: (candidate) =>
          (candidate.signal.altStack = { state: "enabled", sp: "0x7000", sizeBytes: 8192 }),
        detail: {
          altStack: { state: "enabled", sp: "0x7000", sizeBytes: 8192 },
          requiredModel: expect.arrayContaining(["target alt-stack allocation"]),
        },
      },
      {
        name: "malformed",
        mutate: (candidate) => (candidate.signal.blocked = ["not-hex"]),
        detail: { maskKind: "blocked", masks: ["not-hex"] },
      },
    ];

    for (const entry of cases) {
      const candidate = thread();
      entry.mutate(candidate);
      expect(
        planNativeSignalRestorePolicy({
          thread: candidate,
          blockedMaskPolicy: "restore-safe-mask",
        }),
        entry.name,
      ).toMatchObject({
        state: "refused",
        refusals: [
          expect.objectContaining({
            code: expect.stringMatching(/^signal-/),
            detail: expect.objectContaining({ threadId: candidate.id, ...entry.detail }),
          }),
        ],
      });
    }
  });
});
