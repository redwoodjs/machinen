import { describe, expect, it } from "vitest";
import { materializeNativeReturnChainFrames } from "../native-return-chain-materializer.ts";
import { planNativeReturnChain } from "../native-return-chain.ts";

function plan() {
  return planNativeReturnChain({
    targetStackBase: "0x50000000f000",
    targetStackLimit: "0x500000010000",
    maxFrames: 4,
    frames: [
      {
        id: "frame:leaf-caller",
        framePointer: "0x50000000ff00",
        canonicalFrameAddress: "0x50000000ff10",
        returnAddressSlot: "0x50000000ff08",
        returnAddress: "0x700300000316",
        unwindId: "target:leaf-caller@v1",
        callerFramePointer: "0x50000000ff40",
      },
      {
        id: "frame:main",
        framePointer: "0x50000000ff40",
        canonicalFrameAddress: "0x50000000ff50",
        returnAddressSlot: "0x50000000ff48",
        returnAddress: "0x700300000500",
        unwindId: "target:main@v1",
      },
    ],
  });
}

describe("native return-chain materializer", () => {
  it("emits caller-frame and return-address writes for a two-frame chain", () => {
    const result = materializeNativeReturnChainFrames(plan());

    expect(result).toMatchObject({
      state: "materialized",
      initialFramePointer: "0x50000000ff00",
    });
    expect(result.state === "materialized" ? result.writes : []).toEqual([
      expect.objectContaining({
        frameId: "frame:leaf-caller",
        targetAddress: "0x50000000ff00",
        value: "0x50000000ff40",
        bytes: "40ff000000500000",
        kind: "caller-frame-pointer",
      }),
      expect.objectContaining({
        frameId: "frame:leaf-caller",
        targetAddress: "0x50000000ff08",
        value: "0x700300000316",
        bytes: "1603000003700000",
        kind: "return-address",
      }),
      expect.objectContaining({
        frameId: "frame:main",
        targetAddress: "0x50000000ff48",
        value: "0x700300000500",
        bytes: "0005000003700000",
        kind: "return-address",
      }),
    ]);
  });

  it("refuses to materialize refused return-chain plans", () => {
    const refused = plan();
    refused.state = "refused";
    refused.refusals = [{ code: "target-return-slot-unsupported", message: "bad slot" }];

    expect(materializeNativeReturnChainFrames(refused)).toEqual({
      state: "refused",
      refusals: [{ code: "target-return-slot-unsupported", message: "bad slot" }],
    });
  });
});
