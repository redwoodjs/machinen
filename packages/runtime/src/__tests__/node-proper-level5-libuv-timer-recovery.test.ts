import { describe, expect, it } from "vitest";

import { recoverNodeProperLevel5LibuvTimerEvidence } from "../node-proper-level5-libuv-timer-recovery.ts";

const encoder = new TextEncoder();

function fragment(text: string, bytesPath = "memory.bin") {
  return { bytes: encoder.encode(text), bytesPath };
}

describe("proper Node Level 5 libuv timer recovery", () => {
  it("accepts exactly one timer anchor with callback evidence", () => {
    const result = recoverNodeProperLevel5LibuvTimerEvidence(
      [fragment("prefix machinen-level5-libuv-timer-anchor-v1 machinenTimerCallback suffix")],
      {
        anchor: "machinen-level5-libuv-timer-anchor-v1",
        callbackName: "machinenTimerCallback",
      },
    );

    expect(result).toMatchObject({
      accepted: true,
      timerCount: 1,
      candidates: [
        {
          anchor: "machinen-level5-libuv-timer-anchor-v1",
          bytesPath: "memory.bin",
          evidence: [
            "timer anchor string found in accepted source memory",
            "timer callback name found in accepted source memory",
          ],
        },
      ],
      refusals: [],
    });
  });

  it("refuses missing, ambiguous, and active timer callback shapes", () => {
    expect(
      recoverNodeProperLevel5LibuvTimerEvidence([fragment("nothing here")], {
        anchor: "machinen-level5-libuv-timer-anchor-v1",
      }).refusals[0]?.code,
    ).toBe("node-proper-level5-libuv-timer-missing");

    expect(
      recoverNodeProperLevel5LibuvTimerEvidence(
        [
          fragment("machinen-level5-libuv-timer-anchor-v1", "a.bin"),
          fragment("machinen-level5-libuv-timer-anchor-v1", "b.bin"),
        ],
        { anchor: "machinen-level5-libuv-timer-anchor-v1" },
      ).refusals[0]?.code,
    ).toBe("node-proper-level5-libuv-timer-ambiguous");

    expect(
      recoverNodeProperLevel5LibuvTimerEvidence([], {
        anchor: "machinen-level5-libuv-timer-anchor-v1",
        activeCallbackDetected: true,
      }).refusals[0]?.code,
    ).toBe("node-proper-level5-libuv-timer-callback-active-unsupported");
  });
});
