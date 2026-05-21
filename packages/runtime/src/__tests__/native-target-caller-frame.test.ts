import { describe, expect, it } from "vitest";

import { planNativeSyntheticTargetCallerFrame } from "../native-target-caller-frame.ts";
import type { NativeTargetFrameStateMaterializationResult } from "../native-target-frame-state.ts";

const frameState: NativeTargetFrameStateMaterializationResult = {
  requirements: [
    {
      sourceFrameId: "frame:thread:libc",
      targetAddress: "0x7001000b6ca0",
      register: "r15",
      slot: { register: "r15", offset: -16 },
    },
  ],
  materialized: [
    {
      requirement: {
        sourceFrameId: "frame:thread:libc",
        targetAddress: "0x7001000b6ca0",
        register: "r15",
        slot: { register: "r15", offset: -16 },
      },
      value: "0x0",
      valueSource: "synthetic-target-caller",
    },
  ],
  refusals: [],
};

describe("native synthetic target caller frame planning", () => {
  it("plans a synthetic caller frame from complete frame-state materialization", () => {
    const planned = planNativeSyntheticTargetCallerFrame({
      frameState,
      policy: { mode: "abi-neutral-sentinel" },
    });

    expect(planned.refusals).toEqual([]);
    expect(planned.frame).toMatchObject({
      stackPointer: "0x0",
      returnAddress: "0x0",
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      slots: [
        { register: "r15", offset: -16, value: "0x0", valueSource: "synthetic-target-caller" },
      ],
    });
  });

  it("refuses missing policy or incomplete frame-state slots", () => {
    expect(planNativeSyntheticTargetCallerFrame({ frameState }).refusals[0]?.code).toBe(
      "target-caller-frame-unavailable",
    );

    expect(
      planNativeSyntheticTargetCallerFrame({
        frameState: { ...frameState, materialized: [] },
        policy: { mode: "abi-neutral-sentinel" },
      }).refusals[0]?.code,
    ).toBe("target-caller-frame-unavailable");
  });
});
