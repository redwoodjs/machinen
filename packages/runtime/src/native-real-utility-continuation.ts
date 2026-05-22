/** Safety-ordered planner for first real utility native continuation attempts. */

import type {
  NativeCodeLocationMapping,
  NativeProcessImageRefusal,
} from "./native-process-image.ts";
import type { NativeTargetFrameStateMaterializationResult } from "./native-target-frame-state.ts";
import type { NativeTargetUnwindMatchResult } from "./native-target-unwind.ts";
import type { NativeDiscoveredUnwindFrame } from "./native-unwind-frames.ts";

export type NativeRealUtilityContinuationBoundary =
  | "thread-state"
  | "resource-boundary"
  | "mapping-materialization"
  | "target-code-location"
  | "source-unwind"
  | "target-unwind"
  | "target-frame-state"
  | "ready";

export interface NativeRealUtilityContinuationRequest {
  threadRefusals?: NativeProcessImageRefusal[];
  resourceRefusals?: NativeProcessImageRefusal[];
  mappingRefusals?: NativeProcessImageRefusal[];
  codeLocations: NativeCodeLocationMapping[];
  sourceFrames: NativeDiscoveredUnwindFrame[];
  sourceFrameRefusals?: NativeProcessImageRefusal[];
  sourceUnwindRequired?: boolean;
  targetUnwind?: NativeTargetUnwindMatchResult;
  targetUnwindMatched?: boolean;
  targetFrameState?: NativeTargetFrameStateMaterializationResult;
  targetFrameStateMaterialized?: boolean;
}

export interface NativeRealUtilityContinuationPlan {
  state: "ready" | "refused";
  blockingBoundary: NativeRealUtilityContinuationBoundary;
  blockingRefusal?: NativeProcessImageRefusal;
  attemptedResume: false;
  sourceTextReusedAsTargetCode: false;
  sourceIsaEmulationUsed: false;
  sidecarRuntimeUsed: false;
}

export function planNativeRealUtilityContinuationAttempt(
  request: NativeRealUtilityContinuationRequest,
): NativeRealUtilityContinuationPlan {
  const ordered = firstOrderedRefusal(request);
  if (ordered) {
    return refusedPlan(ordered.boundary, ordered.refusal);
  }
  const targetUnwind = targetUnwindRefusal(request);
  if (targetUnwind) {
    return refusedPlan("target-unwind", targetUnwind);
  }
  const targetFrameState = targetFrameStateRefusal(request);
  if (targetFrameState) {
    return refusedPlan("target-frame-state", targetFrameState);
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

function firstOrderedRefusal(
  request: NativeRealUtilityContinuationRequest,
):
  | { boundary: NativeRealUtilityContinuationBoundary; refusal: NativeProcessImageRefusal }
  | undefined {
  return (
    firstRefusal("thread-state", request.threadRefusals) ??
    firstRefusal("resource-boundary", request.resourceRefusals) ??
    firstRefusal("mapping-materialization", request.mappingRefusals) ??
    codeLocationRefusal(request.codeLocations) ??
    sourceUnwindGateRefusal(request)
  );
}

function sourceUnwindGateRefusal(request: NativeRealUtilityContinuationRequest) {
  if (request.sourceUnwindRequired === false) {
    return undefined;
  }
  return (
    firstRefusal("source-unwind", request.sourceFrameRefusals) ??
    sourceUnwindRefusal(request.sourceFrames)
  );
}

function firstRefusal(
  boundary: NativeRealUtilityContinuationBoundary,
  refusals: NativeProcessImageRefusal[] | undefined,
) {
  const refusal = refusals?.[0];
  return refusal ? { boundary, refusal } : undefined;
}

function codeLocationRefusal(codeLocations: NativeCodeLocationMapping[]) {
  const missing = codeLocations.find((location) => location.state !== "mapped");
  if (!missing) {
    return undefined;
  }
  return {
    boundary: "target-code-location" as const,
    refusal:
      missing.refusal ??
      ({
        code: "target-code-location-unresolved",
        message: `code location ${missing.id} did not map to target-native code`,
      } satisfies NativeProcessImageRefusal),
  };
}

function sourceUnwindRefusal(sourceFrames: NativeDiscoveredUnwindFrame[]) {
  if (sourceFrames.length > 0) {
    return undefined;
  }
  return {
    boundary: "source-unwind" as const,
    refusal: {
      code: "unwind-fde-missing" as const,
      message: "no source unwind frame is available for real utility continuation",
    },
  };
}

function targetUnwindRefusal(
  request: NativeRealUtilityContinuationRequest,
): NativeProcessImageRefusal | undefined {
  if (request.targetUnwind?.refusals[0]) {
    return request.targetUnwind.refusals[0];
  }
  if (
    request.targetUnwind &&
    request.targetUnwind.matches.length === 0 &&
    !request.targetUnwindMatched
  ) {
    return {
      code: "target-unwind-mismatch",
      message: "target unwind matching produced no safe frame match",
    };
  }
  if (!request.targetUnwind && !request.targetUnwindMatched) {
    return {
      code: "target-unwind-mismatch",
      message: "source .eh_frame frame has not been matched to a target-native unwind landing",
    };
  }
  return undefined;
}

function targetFrameStateRefusal(
  request: NativeRealUtilityContinuationRequest,
): NativeProcessImageRefusal | undefined {
  if (request.targetFrameState?.refusals[0]) {
    return request.targetFrameState.refusals[0];
  }
  if (request.targetFrameStateMaterialized || targetFrameStateComplete(request.targetFrameState)) {
    return undefined;
  }
  const unsupportedSlot = request.targetUnwind?.matches
    .flatMap((match) => match.targetCalleeSavedSlots ?? [])
    .find((slot) => slot.register !== "rbp");
  if (!unsupportedSlot) {
    return undefined;
  }
  return {
    code: "target-callee-saved-state-unsupported",
    message: `target callee-saved ${unsupportedSlot.register} slot is not materialized yet`,
    detail: { register: unsupportedSlot.register, offset: unsupportedSlot.offset },
  };
}

function targetFrameStateComplete(
  targetFrameState: NativeTargetFrameStateMaterializationResult | undefined,
): boolean {
  return Boolean(
    targetFrameState &&
    targetFrameState.requirements.length > 0 &&
    targetFrameState.materialized.length === targetFrameState.requirements.length,
  );
}

function refusedPlan(
  boundary: NativeRealUtilityContinuationBoundary,
  refusal: NativeProcessImageRefusal,
): NativeRealUtilityContinuationPlan {
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
