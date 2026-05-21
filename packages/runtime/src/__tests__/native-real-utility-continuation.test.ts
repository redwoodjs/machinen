import { describe, expect, it } from "vitest";

import { planNativeRealUtilityContinuationAttempt } from "../native-real-utility-continuation.ts";
import type { NativeDiscoveredUnwindFrame } from "../native-unwind-frames.ts";

const frame: NativeDiscoveredUnwindFrame = {
  id: "frame:thread:real",
  functionName: "real_utility_loop",
  sourcePc: "0x401000",
  sourceSp: "0x7fff0000",
  cfa: "0x7fff0040",
  returnAddress: "0x401080",
  returnAddressSlot: "0x7fff0038",
  metadata: "eh-frame",
  stackFrame: {
    id: "frame:thread:real",
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
  };
}

describe("native real utility continuation planner", () => {
  it("refuses in safety-gate order before any resume attempt", () => {
    expect(
      planNativeRealUtilityContinuationAttempt({
        ...readyInput(),
        threadRefusals: [{ code: "active-syscall", message: "blocked" }],
        resourceRefusals: [{ code: "non-stdio-kernel-state-unsupported", message: "socket" }],
      }),
    ).toMatchObject({
      state: "refused",
      blockingBoundary: "thread-state",
      blockingRefusal: { code: "active-syscall" },
      attemptedResume: false,
    });

    expect(
      planNativeRealUtilityContinuationAttempt({
        ...readyInput(),
        resourceRefusals: [{ code: "non-stdio-kernel-state-unsupported", message: "socket" }],
      }),
    ).toMatchObject({
      blockingBoundary: "resource-boundary",
      blockingRefusal: { code: "non-stdio-kernel-state-unsupported" },
    });
  });

  it("refuses unresolved code, missing source unwind, and unmatched target unwind precisely", () => {
    expect(
      planNativeRealUtilityContinuationAttempt({
        ...readyInput(),
        codeLocations: [
          {
            id: "code:thread:pc",
            sourceMapping: "mapping:text",
            sourceAddress: "0x401000",
            state: "refused",
            refusal: { code: "target-module-missing", message: "missing" },
          },
        ],
      }),
    ).toMatchObject({
      blockingBoundary: "target-code-location",
      blockingRefusal: { code: "target-module-missing" },
    });

    expect(
      planNativeRealUtilityContinuationAttempt({ ...readyInput(), sourceFrames: [] }),
    ).toMatchObject({
      blockingBoundary: "source-unwind",
      blockingRefusal: { code: "unwind-fde-missing" },
    });

    expect(
      planNativeRealUtilityContinuationAttempt({
        ...readyInput(),
        targetUnwind: {
          matches: [],
          refusals: [{ code: "target-unwind-mismatch", message: "bad" }],
        },
      }),
    ).toMatchObject({
      blockingBoundary: "target-unwind",
      blockingRefusal: { code: "target-unwind-mismatch" },
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    });
  });

  it("reports precise target frame-state planner refusals", () => {
    expect(
      planNativeRealUtilityContinuationAttempt({
        ...readyInput(),
        targetFrameState: {
          requirements: [],
          materialized: [],
          refusals: [
            {
              code: "target-frame-register-value-unavailable",
              message: "missing r15",
            },
          ],
        },
      }),
    ).toMatchObject({
      blockingBoundary: "target-frame-state",
      blockingRefusal: { code: "target-frame-register-value-unavailable" },
    });
  });

  it("moves recorded target callee-saved slots to a later frame-state gate", () => {
    expect(
      planNativeRealUtilityContinuationAttempt({
        ...readyInput(),
        targetUnwind: {
          matches: [
            {
              ...readyInput().targetUnwind.matches[0],
              targetCalleeSavedSlots: [{ register: "r15", offset: -16 }],
            },
          ],
          refusals: [],
        },
      }),
    ).toMatchObject({
      blockingBoundary: "target-frame-state",
      blockingRefusal: { code: "target-callee-saved-state-unsupported" },
    });
  });

  it("can report ready without performing the jump", () => {
    expect(planNativeRealUtilityContinuationAttempt(readyInput())).toMatchObject({
      state: "ready",
      blockingBoundary: "ready",
      attemptedResume: false,
      sourceTextReusedAsTargetCode: false,
    });
  });
});
