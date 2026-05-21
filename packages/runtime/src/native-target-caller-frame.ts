/** Synthetic target caller-frame planning for actual native continuations. */

import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type {
  NativeTargetFrameStateMaterialization,
  NativeTargetFrameStateMaterializationResult,
} from "./native-target-frame-state.ts";

export interface NativeSyntheticTargetCallerFramePolicy {
  mode: "abi-neutral-sentinel";
  returnAddress?: string;
  stackPointer?: string;
}

export interface NativeSyntheticTargetCallerFrameSlot {
  register: NativeTargetFrameStateMaterialization["requirement"]["register"];
  offset: number;
  value: string;
  valueSource: NativeTargetFrameStateMaterialization["valueSource"];
}

export interface NativeSyntheticTargetCallerFrame {
  id: string;
  stackPointer: string;
  returnAddress: string;
  slots: NativeSyntheticTargetCallerFrameSlot[];
  sourceTextReusedAsTargetCode: false;
  sourceIsaEmulationUsed: false;
  sidecarRuntimeUsed: false;
}

export interface NativeSyntheticTargetCallerFramePlanRequest {
  frameState: NativeTargetFrameStateMaterializationResult;
  policy?: NativeSyntheticTargetCallerFramePolicy;
}

export interface NativeSyntheticTargetCallerFramePlanResult {
  state: "planned" | "refused";
  frame?: NativeSyntheticTargetCallerFrame;
  refusals: NativeProcessImageRefusal[];
}

export function planNativeSyntheticTargetCallerFrame(
  request: NativeSyntheticTargetCallerFramePlanRequest,
): NativeSyntheticTargetCallerFramePlanResult {
  if (!request.policy) {
    return refused("synthetic target caller frame policy was not provided");
  }
  if (request.frameState.refusals[0]) {
    return { state: "refused", refusals: request.frameState.refusals };
  }
  if (request.frameState.materialized.length !== request.frameState.requirements.length) {
    return refused("synthetic target caller frame is missing materialized frame-state slots");
  }
  return {
    state: "planned",
    frame: {
      id: "synthetic-target-caller-frame:actual-real-utility",
      stackPointer: request.policy.stackPointer ?? "0x0",
      returnAddress: request.policy.returnAddress ?? "0x0",
      slots: request.frameState.materialized.map(callerFrameSlot),
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    },
    refusals: [],
  };
}

function callerFrameSlot(
  materialized: NativeTargetFrameStateMaterialization,
): NativeSyntheticTargetCallerFrameSlot {
  return {
    register: materialized.requirement.register,
    offset: materialized.requirement.slot.offset,
    value: materialized.value,
    valueSource: materialized.valueSource,
  };
}

function refused(message: string): NativeSyntheticTargetCallerFramePlanResult {
  return {
    state: "refused",
    refusals: [{ code: "target-caller-frame-unavailable", message }],
  };
}
