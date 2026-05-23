import { describe, expect, it } from "vitest";
import {
  planNativeReturnChain,
  type NativeReturnChainPlanRequest,
} from "../native-return-chain.ts";

function request(): NativeReturnChainPlanRequest {
  return {
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
  };
}

describe("native return chain planning", () => {
  it("materializes a bounded two-frame target return chain", () => {
    const result = planNativeReturnChain(request());

    expect(result.state).toBe("materialized");
    expect(result.refusals).toEqual([]);
    expect(result.frames).toEqual([
      expect.objectContaining({ id: "frame:leaf-caller", index: 0 }),
      expect.objectContaining({ id: "frame:main", index: 1 }),
    ]);
  });

  it("refuses chains that exceed the configured frame bound", () => {
    const input = request();
    input.maxFrames = 1;

    const result = planNativeReturnChain(input);

    expect(result.state).toBe("refused");
    expect(result.refusals).toContainEqual(
      expect.objectContaining({
        code: "target-frame-layout-unsupported",
        message: expect.stringContaining("exceeds"),
      }),
    );
  });

  it("refuses unlinked caller frames", () => {
    const input = request();
    input.frames[0]!.callerFramePointer = "0x50000000ff80";

    const result = planNativeReturnChain(input);

    expect(result.refusals).toContainEqual(
      expect.objectContaining({
        code: "target-frame-layout-unsupported",
        message: expect.stringContaining("caller link"),
      }),
    );
  });

  it("refuses return slots that do not match framePointer + 8", () => {
    const input = request();
    input.frames[0]!.returnAddressSlot = "0x50000000ff20";

    const result = planNativeReturnChain(input);

    expect(result.refusals).toContainEqual(
      expect.objectContaining({
        code: "target-return-slot-unsupported",
        message: expect.stringContaining("framePointer + 8"),
      }),
    );
  });

  it("refuses frame addresses outside the target stack", () => {
    const input = request();
    input.frames[1]!.framePointer = "0x40000000ff40";

    const result = planNativeReturnChain(input);

    expect(result.refusals).toContainEqual(
      expect.objectContaining({
        code: "target-frame-layout-unsupported",
        message: expect.stringContaining("outside target stack"),
      }),
    );
  });

  it("refuses source or untrusted unwind provenance", () => {
    const input = request();
    input.frames[1]!.unwindId = "source:main";

    const result = planNativeReturnChain(input);

    expect(result.refusals).toContainEqual(
      expect.objectContaining({
        code: "target-frame-layout-unsupported",
        message: expect.stringContaining("unwind identity"),
      }),
    );
  });

  it("refuses malformed addresses without throwing", () => {
    const input = request();
    input.frames[0]!.framePointer = "not-hex";

    const result = planNativeReturnChain(input);

    expect(result.state).toBe("refused");
    expect(result.frames[0]!.framePointer).toBe("not-hex");
    expect(result.refusals).toContainEqual(
      expect.objectContaining({
        code: "target-frame-layout-unsupported",
        message: expect.stringContaining("not a valid address"),
      }),
    );
  });
});
