import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type { NativeReturnChainPlan, NativeReturnChainPlanFrame } from "./native-return-chain.ts";

export interface NativeReturnChainFrameWrite {
  frameId: string;
  targetAddress: string;
  value: string;
  bytes: string;
  kind: "caller-frame-pointer" | "return-address";
}

export type NativeReturnChainMaterialization =
  | {
      state: "materialized";
      initialFramePointer: string;
      targetStack: NativeReturnChainPlan["targetStack"];
      writes: NativeReturnChainFrameWrite[];
      refusals: [];
    }
  | {
      state: "refused";
      refusals: NativeProcessImageRefusal[];
    };

export function materializeNativeReturnChainFrames(
  plan: NativeReturnChainPlan,
): NativeReturnChainMaterialization {
  if (plan.state !== "materialized") {
    return { state: "refused", refusals: plan.refusals };
  }
  return {
    state: "materialized",
    initialFramePointer: plan.frames[0]!.framePointer,
    targetStack: plan.targetStack,
    writes: plan.frames.flatMap((frame) => frameWrites(frame)),
    refusals: [],
  };
}

function frameWrites(frame: NativeReturnChainPlanFrame): NativeReturnChainFrameWrite[] {
  return [
    ...callerFramePointerWrite(frame),
    {
      frameId: frame.id,
      targetAddress: frame.returnAddressSlot,
      value: frame.returnAddress,
      bytes: littleEndianU64Hex(frame.returnAddress),
      kind: "return-address" as const,
    },
  ];
}

function callerFramePointerWrite(frame: NativeReturnChainPlanFrame): NativeReturnChainFrameWrite[] {
  return frame.callerFramePointer === undefined
    ? []
    : [
        {
          frameId: frame.id,
          targetAddress: frame.framePointer,
          value: frame.callerFramePointer,
          bytes: littleEndianU64Hex(frame.callerFramePointer),
          kind: "caller-frame-pointer",
        },
      ];
}

function littleEndianU64Hex(value: string): string {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes.toString("hex");
}
