/** Target-native resume execution planning for actual utility continuations. */

import type {
  NativeCodeLocationMapping,
  NativeProcessImageRefusal,
} from "./native-process-image.ts";
import type { NativeSyntheticTargetCallerFrame } from "./native-target-caller-frame.ts";
import type { NativeTargetModuleByteMaterialization } from "./native-target-module-bytes.ts";

export type NativeTargetResumeExecutionMode = "planned-not-executed";
export type NativeTargetResumeExecutor = "native-resume-trampoline";
export type NativeTargetResumeExecutionAttemptStatus = "returned" | "faulted";

export interface NativeTargetResumeExecutionAttempt {
  status: NativeTargetResumeExecutionAttemptStatus;
  targetArch: "amd64";
  entryAddress: string;
  stackPointer: string;
  targetBytesStart: string;
  targetBytesEnd: string;
  targetInstructionPointer?: string;
  signal?: string;
  signalNumber?: number;
  faultAddress?: string;
  returnValue?: string;
  instructionPointerInTargetBytes: boolean;
  attemptedResume: true;
  sourceTextReusedAsTargetCode: false;
  sourceIsaEmulationUsed: false;
  sidecarRuntimeUsed: false;
}

export interface NativeTargetResumeExecutionPlan {
  mode: NativeTargetResumeExecutionMode;
  executor: NativeTargetResumeExecutor;
  targetArch: "amd64";
  entryAddress: string;
  stackPointer: string;
  callerFrameId: string;
  targetModuleByteModules: string[];
  attemptedResume: false;
  sourceTextReusedAsTargetCode: false;
  sourceIsaEmulationUsed: false;
  sidecarRuntimeUsed: false;
}

export interface NativeTargetResumeExecutionPlanRequest {
  codeLocations: NativeCodeLocationMapping[];
  targetModuleBytes: NativeTargetModuleByteMaterialization[];
  callerFrame?: NativeSyntheticTargetCallerFrame;
}

export interface NativeTargetResumeExecutionPlanResult {
  state: "planned" | "refused";
  plan?: NativeTargetResumeExecutionPlan;
  refusals: NativeProcessImageRefusal[];
}

export function planNativeTargetResumeExecution(
  request: NativeTargetResumeExecutionPlanRequest,
): NativeTargetResumeExecutionPlanResult {
  const entry = mappedCodeLocation(request.codeLocations);
  if (!entry) {
    return refused("target-native resume requires a mapped target code location");
  }
  if (request.targetModuleBytes.length === 0) {
    return refused("target-native resume requires explicit target module bytes");
  }
  if (!request.callerFrame) {
    return refused("target-native resume requires a synthetic target caller frame");
  }
  return {
    state: "planned",
    plan: {
      mode: "planned-not-executed",
      executor: "native-resume-trampoline",
      targetArch: "amd64",
      entryAddress: entry.targetAddress,
      stackPointer: request.callerFrame.stackPointer,
      callerFrameId: request.callerFrame.id,
      targetModuleByteModules: request.targetModuleBytes.map((bytes) => bytes.moduleId),
      attemptedResume: false,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    },
    refusals: [],
  };
}

function mappedCodeLocation(codeLocations: NativeCodeLocationMapping[]) {
  return codeLocations.find((location) => location.state === "mapped" && location.targetAddress);
}

function refused(message: string): NativeTargetResumeExecutionPlanResult {
  return {
    state: "refused",
    refusals: [{ code: "target-resume-execution-unavailable", message }],
  };
}
