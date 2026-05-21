/** Actual captured real-utility continuation gate planner. */

import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import {
  planNativeRealUtilityContinuationAttempt,
  type NativeRealUtilityContinuationBoundary,
  type NativeRealUtilityContinuationRequest,
} from "./native-real-utility-continuation.ts";

export type NativeActualRealUtilityContinuationBoundary =
  | NativeRealUtilityContinuationBoundary
  | "target-module-bytes";

export interface NativeActualRealUtilityContinuationRequest extends NativeRealUtilityContinuationRequest {
  targetModuleByteRefusals?: NativeProcessImageRefusal[];
  targetModuleBytesMaterialized?: boolean;
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

  return {
    state: "ready",
    blockingBoundary: "ready",
    attemptedResume: false,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
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
