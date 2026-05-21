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
export type NativeTargetResumeFaultBoundary = "target-resume-fault-state";

export interface NativeTargetResumeFaultRegisters {
  rax?: string;
  rbx?: string;
  rcx?: string;
  rdx?: string;
  rsi?: string;
  rdi?: string;
  rbp?: string;
  rsp?: string;
  r8?: string;
  r9?: string;
  r10?: string;
  r11?: string;
  r12?: string;
  r13?: string;
  r14?: string;
  r15?: string;
}

export interface NativeTargetResumeFaultClassification {
  boundary: NativeTargetResumeFaultBoundary;
  refusal: NativeProcessImageRefusal;
  signal?: string;
  faultAddress?: string;
  targetInstructionPointer?: string;
  targetInstructionBytes?: string;
  registers?: NativeTargetResumeFaultRegisters;
  attemptedResume: true;
  migrationCompleted: false;
}

export interface NativeTargetResumeFaultClassificationResult {
  state: "classified" | "not-faulted" | "unattempted";
  classification?: NativeTargetResumeFaultClassification;
  refusals: NativeProcessImageRefusal[];
}

export interface NativeTargetResumeExecutionAttempt {
  status: NativeTargetResumeExecutionAttemptStatus;
  targetArch: "amd64";
  entryAddress: string;
  stackPointer: string;
  targetBytesStart: string;
  targetBytesEnd: string;
  targetInstructionPointer?: string;
  targetInstructionBytes?: string;
  registers?: NativeTargetResumeFaultRegisters;
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

export function classifyNativeTargetResumeExecutionAttempt(
  attempt: NativeTargetResumeExecutionAttempt | undefined,
): NativeTargetResumeFaultClassificationResult {
  if (!attempt) {
    return { state: "unattempted", refusals: [] };
  }
  if (attempt.status !== "faulted") {
    return { state: "not-faulted", refusals: [] };
  }
  const refusal = classifyTargetResumeFaultRefusal(attempt);
  return {
    state: "classified",
    classification: {
      boundary: "target-resume-fault-state",
      refusal,
      signal: attempt.signal,
      faultAddress: attempt.faultAddress,
      targetInstructionPointer: attempt.targetInstructionPointer,
      targetInstructionBytes: attempt.targetInstructionBytes,
      registers: attempt.registers,
      attemptedResume: true,
      migrationCompleted: false,
    },
    refusals: [refusal],
  };
}

function classifyTargetResumeFaultRefusal(
  attempt: NativeTargetResumeExecutionAttempt,
): NativeProcessImageRefusal {
  if (!attempt.instructionPointerInTargetBytes) {
    return faultRefusal(
      "target-resume-fault-outside-target-bytes",
      "target-native resume faulted after leaving the explicit target byte window",
      attempt,
    );
  }
  if (attempt.signal === "SIGALRM") {
    return faultRefusal(
      "target-resume-fault-timeout",
      "target-native resume did not return or fault before the bounded execution timer fired",
      attempt,
    );
  }
  if (startsWithPrivilegedIoInstruction(attempt.targetInstructionBytes)) {
    return faultRefusal(
      "target-resume-fault-privileged-instruction",
      "target-native resume entered an amd64 privileged I/O instruction in the target byte window",
      attempt,
    );
  }
  if (attempt.signal === "SIGSEGV" || attempt.signal === "SIGBUS") {
    return faultRefusal(
      "target-resume-fault-unmodeled-memory",
      `target-native resume faulted on memory address ${attempt.faultAddress ?? "unknown"}`,
      attempt,
    );
  }
  return faultRefusal(
    "target-resume-fault-signal-unsupported",
    `target-native resume faulted with unsupported signal ${attempt.signal ?? "unknown"}`,
    attempt,
  );
}

function startsWithPrivilegedIoInstruction(bytes: string | undefined): boolean {
  const firstByte = bytes?.trim().slice(0, 2).toLowerCase();
  return ["e4", "e5", "e6", "e7", "ec", "ed", "ee", "ef"].includes(firstByte ?? "");
}

function faultRefusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
  attempt: NativeTargetResumeExecutionAttempt,
): NativeProcessImageRefusal {
  return {
    code,
    message,
    detail: {
      signal: attempt.signal,
      signalNumber: attempt.signalNumber,
      faultAddress: attempt.faultAddress,
      targetInstructionPointer: attempt.targetInstructionPointer,
      targetInstructionBytes: attempt.targetInstructionBytes,
      registers: attempt.registers,
      instructionPointerInTargetBytes: attempt.instructionPointerInTargetBytes,
    },
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
