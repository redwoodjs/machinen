/** Actual captured real-utility continuation gate planner. */

import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import {
  planNativeRealUtilityContinuationAttempt,
  type NativeRealUtilityContinuationBoundary,
  type NativeRealUtilityContinuationRequest,
} from "./native-real-utility-continuation.ts";

export type NativeActualRealUtilityContinuationBoundary =
  | NativeRealUtilityContinuationBoundary
  | "target-module-bytes"
  | "target-caller-frame";

export interface NativeActualRealUtilityContinuationRequest extends NativeRealUtilityContinuationRequest {
  targetModuleByteRefusals?: NativeProcessImageRefusal[];
  targetModuleBytesMaterialized?: boolean;
  targetCallerFrameRefusals?: NativeProcessImageRefusal[];
  targetCallerFrameMaterialized?: boolean;
}

export interface NativeActualRealUtilityContinuationPlan {
  state: "ready" | "refused";
  blockingBoundary: NativeActualRealUtilityContinuationBoundary;
  blockingRefusal?: NativeProcessImageRefusal;
  attemptedResume: false;
  sourceTextReusedAsTargetCode: false;
  sourceIsaEmulationUsed: false;
  sidecarRuntimeUsed: false;
}

export function planNativeActualRealUtilityContinuationAttempt(
  request: NativeActualRealUtilityContinuationRequest,
): NativeActualRealUtilityContinuationPlan {
  const safetyPlan = planNativeRealUtilityContinuationAttempt(request);
  if (safetyPlan.state === "refused") {
    return safetyPlan;
  }

  const byteRefusal = request.targetModuleByteRefusals?.[0];
  if (byteRefusal) {
    return refusedPlan("target-module-bytes", byteRefusal);
  }
  if (!request.targetModuleBytesMaterialized) {
    return refusedPlan("target-module-bytes", {
      code: "target-module-bytes-missing",
      message: "no explicit target module bytes were materialized for actual real utility resume",
    });
  }

  const callerFrameRefusal = targetCallerFrameRefusal(request);
  if (callerFrameRefusal) {
    return refusedPlan("target-caller-frame", callerFrameRefusal);
  }

  return {
    state: "ready",
    blockingBoundary: "ready",
    attemptedResume: false,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
  };
}

function targetCallerFrameRefusal(
  request: NativeActualRealUtilityContinuationRequest,
): NativeProcessImageRefusal | undefined {
  if (request.targetCallerFrameRefusals?.[0]) {
    return request.targetCallerFrameRefusals[0];
  }
  if (request.targetCallerFrameMaterialized) {
    return undefined;
  }
  return {
    code: "target-caller-frame-unavailable",
    message:
      "synthetic target caller frame has not been materialized for actual real utility resume",
  };
}

function refusedPlan(
  boundary: NativeActualRealUtilityContinuationBoundary,
  refusal: NativeProcessImageRefusal,
): NativeActualRealUtilityContinuationPlan {
  return {
    state: "refused",
    blockingBoundary: boundary,
    blockingRefusal: refusal,
    attemptedResume: false,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
  };
}
