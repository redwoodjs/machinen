import { describe, expect, it } from "vitest";

import { planNativeTargetFrameStateMaterialization } from "../native-target-frame-state.ts";
import type { NativeTargetUnwindMatchResult } from "../native-target-unwind.ts";

const targetUnwind: NativeTargetUnwindMatchResult = {
  matches: [
    {
      sourceFrameId: "frame:thread:libc",
      targetRule: {
        id: "target-eh-frame:libc:0x7001000b5f90",
        functionName: "libc.so.6",
        mapping: "target:mapping:libc",
        pcStart: "0x7001000b5f90",
        pcEnd: "0x7001000b7f8b",
        metadata: "eh-frame",
        cfa: { register: "rsp", offset: 56 },
        returnAddress: { location: "cfa-relative", offset: -8 },
      },
      targetAddress: "0x7001000b6ca0",
      targetReturnAddressSlotOffset: -8,
      targetCalleeSavedSlots: [
        { register: "r15", offset: -16 },
        { register: "r14", offset: -24 },
      ],
      preservesReturnContract: true,
    },
  ],
  refusals: [],
};

describe("native target frame-state materialization", () => {
  it("records callee-saved slot requirements and refuses missing target values", () => {
    const planned = planNativeTargetFrameStateMaterialization({ targetUnwind });

    expect(planned.requirements).toMatchObject([
      { register: "r15", slot: { offset: -16 }, targetAddress: "0x7001000b6ca0" },
      { register: "r14", slot: { offset: -24 }, targetAddress: "0x7001000b6ca0" },
    ]);
    expect(planned.materialized).toEqual([]);
    expect(planned.refusals[0]).toMatchObject({
      code: "target-frame-register-value-unavailable",
      detail: { register: "r15", slot: { offset: -16 } },
    });
  });

  it("materializes synthetic target-caller slots only with an explicit policy", () => {
    const planned = planNativeTargetFrameStateMaterialization({
      targetUnwind,
      syntheticTargetCaller: { mode: "abi-neutral-sentinel" },
    });

    expect(planned.refusals).toEqual([]);
    expect(planned.materialized).toMatchObject([
      { requirement: { register: "r15" }, value: "0x0", valueSource: "synthetic-target-caller" },
      { requirement: { register: "r14" }, value: "0x0", valueSource: "synthetic-target-caller" },
    ]);
  });

  it("materializes slots when explicit target-native values are supplied", () => {
    const planned = planNativeTargetFrameStateMaterialization({
      targetUnwind,
      registerValues: [
        { register: "r15", value: "0x7000", source: "target-register" },
        { register: "r14", value: "0x7008", source: "target-register" },
      ],
    });

    expect(planned.refusals).toEqual([]);
    expect(planned.materialized).toMatchObject([
      { requirement: { register: "r15" }, value: "0x7000", valueSource: "target-register" },
      { requirement: { register: "r14" }, value: "0x7008", valueSource: "target-register" },
    ]);
  });
});
