import { describe, expect, it } from "vitest";

import { planNativeActualRealUtilityContinuationAttempt } from "../native-actual-real-utility-continuation.ts";
import type { NativeDiscoveredUnwindFrame } from "../native-unwind-frames.ts";

const frame: NativeDiscoveredUnwindFrame = {
  id: "frame:thread:actual-real",
  functionName: "real_utility_loop",
  sourcePc: "0x401000",
  sourceSp: "0x7fff0000",
  cfa: "0x7fff0040",
  returnAddress: "0x401080",
  returnAddressSlot: "0x7fff0038",
  metadata: "eh-frame",
  stackFrame: {
    id: "frame:thread:actual-real",
    sourceSp: "0x7fff0000",
    sourceReturnAddress: "0x401080",
    sizeBytes: 64,
    metadata: "dwarf",
    locals: [],
  },
};

function readyInput() {
  return {
    codeLocations: [
      {
        id: "code:thread:pc",
        sourceMapping: "mapping:text",
        sourceAddress: "0x401000",
        targetAddress: "0x700000001000",
        state: "mapped" as const,
      },
    ],
    sourceFrames: [frame],
    targetUnwind: {
      matches: [
        {
          sourceFrameId: frame.id,
          targetRule: {
            id: "target:frame",
            functionName: "real_utility_loop",
            mapping: "target:mapping:text",
            pcStart: "0x700000001000",
            pcEnd: "0x700000001080",
            metadata: "eh-frame" as const,
            cfa: { register: "rbp" as const, offset: 16 },
            returnAddress: { location: "cfa-relative" as const, offset: -8 },
          },
          targetAddress: "0x700000001000",
          targetReturnAddressSlotOffset: -8,
          preservesReturnContract: true as const,
        },
      ],
      refusals: [],
    },
    targetModuleBytesMaterialized: true,
  };
}

describe("native actual real utility continuation planner", () => {
  it("keeps the real-utility safety gates before target byte materialization", () => {
    expect(
      planNativeActualRealUtilityContinuationAttempt({
        ...readyInput(),
        threadRefusals: [{ code: "active-syscall", message: "sleep is in clock_nanosleep" }],
        targetModuleByteRefusals: [
          { code: "target-module-file-missing", message: "target sleep missing" },
        ],
      }),
    ).toMatchObject({
      state: "refused",
      blockingBoundary: "thread-state",
      blockingRefusal: { code: "active-syscall" },
      attemptedResume: false,
    });
  });

  it("refuses missing or failed target module bytes only after unwind matching", () => {
    expect(
      planNativeActualRealUtilityContinuationAttempt({
        ...readyInput(),
        targetModuleBytesMaterialized: false,
        targetModuleByteRefusals: [
          { code: "target-module-range-unreadable", message: "range outside file" },
        ],
      }),
    ).toMatchObject({
      state: "refused",
      blockingBoundary: "target-module-bytes",
      blockingRefusal: { code: "target-module-range-unreadable" },
    });

    expect(
      planNativeActualRealUtilityContinuationAttempt({
        ...readyInput(),
        targetModuleBytesMaterialized: false,
      }),
    ).toMatchObject({
      state: "refused",
      blockingBoundary: "target-module-bytes",
      blockingRefusal: { code: "target-module-bytes-missing" },
    });
  });

  it("reports ready only when target bytes are explicitly materialized", () => {
    expect(planNativeActualRealUtilityContinuationAttempt(readyInput())).toMatchObject({
      state: "ready",
      blockingBoundary: "ready",
      attemptedResume: false,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    });
  });
});
