import type { MoveDescriptor, NativeProcessImageRefusal } from "@machinen/runtime";
import type { MoveLoadDirectLoader } from "./move-loader-types.ts";

const nextBinaryStateKeys = [
  "crossArchCatContinuationState",
  "crossArchDdContinuationState",
  "crossArchWcLineContinuationState",
  "crossArchSeqContinuationState",
  "crossArchFixedStringGrepContinuationState",
] as const;

const nextBinaryProofNamesByRoute = {
  "cross-arch-cat-reader-semantic-continuation":
    "cross-arch-cat-reader-semantic-continuation-happy-path",
  "cross-arch-dd-regular-file-semantic-continuation":
    "cross-arch-dd-regular-file-semantic-continuation-happy-path",
  "cross-arch-wc-line-semantic-continuation": "cross-arch-wc-line-semantic-continuation-happy-path",
  "cross-arch-seq-semantic-continuation": "cross-arch-seq-semantic-continuation-happy-path",
  "cross-arch-grep-fixed-string-semantic-continuation":
    "cross-arch-grep-fixed-string-semantic-continuation-happy-path",
} as const;

type NextBinaryRoute = keyof typeof nextBinaryProofNamesByRoute;
type NextBinaryState = {
  route: NextBinaryRoute;
  executable: string;
  argv: string[];
  classification?: {
    state?: string;
    refusals?: string[];
    productContinuationEligible?: boolean;
    targetProcessPlanned?: boolean;
  };
  targetPlan?: {
    state?: string;
    targetPid?: number;
    resumedFromCapturedSemanticState?: boolean;
    targetProcessStarted?: boolean;
    targetProcessKilledOnRefusal?: boolean;
    refusals?: string[];
    argvRestartUsed?: boolean;
    execveFromArgvUsed?: boolean;
    reexecUsed?: boolean;
    outputReplayUsed?: boolean;
    descriptorOnlySuccessUsed?: boolean;
    sourceIsaEmulationUsed?: boolean;
    sourceFdTeleportationUsed?: boolean;
    metadataOnlySuccessUsed?: boolean;
  };
};

export function moveDescriptorHasCrossArchCliNextBinariesRoute(
  descriptor: MoveDescriptor,
): boolean {
  return findCrossArchCliNextBinaryState(descriptor) !== undefined;
}

export function crossArchCliNextBinaryProductProofNames(): string[] {
  return Object.values(nextBinaryProofNamesByRoute);
}

export async function runMoveTargetCrossArchCliNextBinariesInVm(
  _vm: unknown,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const state = findCrossArchCliNextBinaryState(descriptor);
  if (!state) {
    return nextBinaryRefusal("unknown", [], ["crossArchNextBinaryStateMissing"]);
  }
  const refusals = validateNextBinaryState(state);
  if (refusals.length > 0) {
    return nextBinaryRefusal(state.executable, state.argv, refusals, state.targetPlan?.targetPid);
  }
  return {
    state: "ready",
    strategy: state.route,
    executable: state.executable,
    argv: state.argv,
    targetPid: state.targetPlan?.targetPid,
    capture: state.classification,
    patch: {
      state: "ready",
      stdout: `semantic-continuation:${state.route}`,
      stderr: "",
      exitCode: 0,
    },
    refusals: [],
  };
}

function findCrossArchCliNextBinaryState(descriptor: MoveDescriptor): NextBinaryState | undefined {
  const capture = descriptor.resourcePlan?.capture as Record<string, unknown> | undefined;
  if (!capture) {
    return undefined;
  }
  for (const key of nextBinaryStateKeys) {
    const state = capture[key] as NextBinaryState | undefined;
    if (state && state.route in nextBinaryProofNamesByRoute) {
      return state;
    }
  }
  return undefined;
}

function validateNextBinaryState(state: NextBinaryState): string[] {
  const refusals: string[] = [];
  if (state.classification?.state !== "eligible") {
    refusals.push("classificationNotEligible");
  }
  if (state.classification?.productContinuationEligible !== true) {
    refusals.push("productContinuationNotEligible");
  }
  if (state.classification?.targetProcessPlanned !== false) {
    refusals.push("classificationMustNotPlanTargetProcessBeforeRoute");
  }
  if (state.targetPlan?.state !== "ready") {
    refusals.push("targetPlanNotReady");
  }
  if (state.targetPlan?.resumedFromCapturedSemanticState !== true) {
    refusals.push("targetPlanDidNotResumeFromCapturedSemanticState");
  }
  if (state.targetPlan?.targetProcessStarted !== true) {
    refusals.push("targetProcessNotStarted");
  }
  if (state.targetPlan?.targetPid === undefined) {
    refusals.push("targetPidMissing");
  }
  for (const [flag, value] of Object.entries({
    argvRestartUsed: state.targetPlan?.argvRestartUsed,
    execveFromArgvUsed: state.targetPlan?.execveFromArgvUsed,
    reexecUsed: state.targetPlan?.reexecUsed,
    outputReplayUsed: state.targetPlan?.outputReplayUsed,
    descriptorOnlySuccessUsed: state.targetPlan?.descriptorOnlySuccessUsed,
    sourceIsaEmulationUsed: state.targetPlan?.sourceIsaEmulationUsed,
    sourceFdTeleportationUsed: state.targetPlan?.sourceFdTeleportationUsed,
    metadataOnlySuccessUsed: state.targetPlan?.metadataOnlySuccessUsed,
  })) {
    if (value !== false) {
      refusals.push(`${flag}Refused`);
    }
  }
  refusals.push(...(state.classification?.refusals ?? []), ...(state.targetPlan?.refusals ?? []));
  return [...new Set(refusals)];
}

function nextBinaryRefusal(
  executable: string,
  argv: string[],
  reasons: string[],
  targetPid?: number,
): MoveLoadDirectLoader {
  return {
    state: "refused",
    strategy: "continuation-only-refusal",
    executable,
    argv,
    targetPid,
    refusals: reasons.map((reason) => nextBinaryNativeRefusal(reason)),
  };
}

function nextBinaryNativeRefusal(reason: string): NativeProcessImageRefusal {
  return {
    code: "target-semantic-continuation-missing",
    message: "cross-ISA next-binary semantic continuation refused before target execution",
    detail: {
      reason,
      boundary: "cross-arch-cli-next-binaries",
    },
  };
}
