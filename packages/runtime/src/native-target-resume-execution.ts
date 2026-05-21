/** Target-native resume execution planning for actual utility continuations. */

import type {
  NativeCodeLocationMapping,
  NativeProcessImageRefusal,
} from "./native-process-image.ts";
import type { NativeSyntheticTargetCallerFrame } from "./native-target-caller-frame.ts";
import type { NativeTargetResumeLandingProvenance } from "./native-target-landing-provenance.ts";
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

export interface NativeTargetResumeFaultClassificationOptions {
  landingProvenance?: NativeTargetResumeLandingProvenance[];
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
  options: NativeTargetResumeFaultClassificationOptions = {},
): NativeTargetResumeFaultClassificationResult {
  if (!attempt) {
    return { state: "unattempted", refusals: [] };
  }
  if (attempt.status !== "faulted") {
    return { state: "not-faulted", refusals: [] };
  }
  const refusal = classifyTargetResumeFaultRefusal(attempt, options);
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
  options: NativeTargetResumeFaultClassificationOptions,
): NativeProcessImageRefusal {
  return (
    outsideTargetBytesRefusal(attempt) ??
    timeoutRefusal(attempt) ??
    invalidLandingRefusal(attempt, options) ??
    privilegedInstructionRefusal(attempt) ??
    unmodeledMemoryRefusal(attempt) ??
    unsupportedSignalRefusal(attempt)
  );
}

function outsideTargetBytesRefusal(
  attempt: NativeTargetResumeExecutionAttempt,
): NativeProcessImageRefusal | undefined {
  if (attempt.instructionPointerInTargetBytes) {
    return undefined;
  }
  return faultRefusal(
    "target-resume-fault-outside-target-bytes",
    "target-native resume faulted after leaving the explicit target byte window",
    attempt,
  );
}

function timeoutRefusal(
  attempt: NativeTargetResumeExecutionAttempt,
): NativeProcessImageRefusal | undefined {
  if (attempt.signal !== "SIGALRM") {
    return undefined;
  }
  return faultRefusal(
    "target-resume-fault-timeout",
    "target-native resume did not return or fault before the bounded execution timer fired",
    attempt,
  );
}

function invalidLandingRefusal(
  attempt: NativeTargetResumeExecutionAttempt,
  options: NativeTargetResumeFaultClassificationOptions,
): NativeProcessImageRefusal | undefined {
  const invalidLanding = invalidLandingForAttempt(attempt, options.landingProvenance ?? []);
  if (!invalidLanding) {
    return undefined;
  }
  return faultRefusal(
    "target-resume-fault-invalid-code-landing",
    `target-native resume entered ${invalidLanding.targetModule.path}+${invalidLanding.targetRelativeAddress}, which is not a valid amd64 instruction boundary`,
    attempt,
    { landing: invalidLanding },
  );
}

function privilegedInstructionRefusal(
  attempt: NativeTargetResumeExecutionAttempt,
): NativeProcessImageRefusal | undefined {
  if (!startsWithPrivilegedIoInstruction(attempt.targetInstructionBytes)) {
    return undefined;
  }
  return faultRefusal(
    "target-resume-fault-privileged-instruction",
    "target-native resume entered an amd64 privileged I/O instruction in the target byte window",
    attempt,
  );
}

function unmodeledMemoryRefusal(
  attempt: NativeTargetResumeExecutionAttempt,
): NativeProcessImageRefusal | undefined {
  if (attempt.signal !== "SIGSEGV" && attempt.signal !== "SIGBUS") {
    return undefined;
  }
  return faultRefusal(
    "target-resume-fault-unmodeled-memory",
    `target-native resume faulted on memory address ${attempt.faultAddress ?? "unknown"}`,
    attempt,
  );
}

function unsupportedSignalRefusal(
  attempt: NativeTargetResumeExecutionAttempt,
): NativeProcessImageRefusal {
  return faultRefusal(
    "target-resume-fault-signal-unsupported",
    `target-native resume faulted with unsupported signal ${attempt.signal ?? "unknown"}`,
    attempt,
  );
}

function invalidLandingForAttempt(
  attempt: NativeTargetResumeExecutionAttempt,
  provenances: NativeTargetResumeLandingProvenance[],
): NativeTargetResumeLandingProvenance | undefined {
  const targetIp = attempt.targetInstructionPointer ?? attempt.entryAddress;
  return provenances.find(
    (provenance) =>
      sameHex(provenance.targetAddress, targetIp) &&
      provenance.instructionBoundary.state === "known-invalid",
  );
}

function sameHex(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return BigInt(left) === BigInt(right);
}

function startsWithPrivilegedIoInstruction(bytes: string | undefined): boolean {
  const firstByte = bytes?.trim().slice(0, 2).toLowerCase();
  return ["e4", "e5", "e6", "e7", "ec", "ed", "ee", "ef"].includes(firstByte ?? "");
}

function faultRefusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
  attempt: NativeTargetResumeExecutionAttempt,
  extraDetail: Record<string, unknown> = {},
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
      ...extraDetail,
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
