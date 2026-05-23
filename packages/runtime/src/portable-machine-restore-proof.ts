import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type { NativeTargetFdTablePlan } from "./native-resource-translation.ts";
import { validatePortableMachineSnapshotBundle } from "./portable-machine-snapshot.ts";
import {
  TARGET_GUEST_RESTORE_DESCRIPTOR_KIND,
  validateTargetGuestRestoreDescriptor,
  type TargetGuestRestoreContinuationDescriptor,
  type TargetGuestRestoreDescriptor,
  type TargetGuestTranslatedFrameDescriptor,
} from "./target-guest-restore-loader.ts";
import type { TargetGuestMemoryMaterializationResult } from "./target-guest-memory-materialization.ts";

export type PortableMachineVmRestoreProofState = "ready" | "skipped" | "refused" | "completed";

export interface PortableMachineVmRestoreProofRequest {
  bundleDir?: string;
  targetCodeFile?: string;
  targetImage?: string;
}

export type PortableMachineTargetVerifierResult = "pending" | "passed" | "failed";
export type PortableMachineTargetContinuationKind = "generated-verifier" | "real-utility";
export type PortableMachineTargetStateConsumptionResult = "pending" | "passed" | "failed";
export type PortableMachineTargetNativePlanConsumptionResult = "pending" | "passed" | "failed";
export type PortableMachineTargetReturnChainResult = "pending" | "passed" | "failed";
export type PortableMachineTargetFrameRestoreResult = "pending" | "passed" | "failed";
export type PortableMachineTargetRegisterRestoreResult = "pending" | "passed" | "failed";
export type PortableMachineTargetRflagsRestoreResult = "pending" | "passed" | "failed";
export type PortableMachineTargetTlsRestoreResult = "pending" | "passed" | "failed";
export type PortableMachineTargetThreadRestoreResult = "accepted" | "refused";
export type PortableMachineTargetResumePathResult = "pending" | "passed" | "failed";

export interface PortableMachineTargetResourceStatus {
  kind: string;
  status: "passed" | "failed";
}

export interface PortableMachineTargetRestoreObservation {
  targetVerifierResult?: PortableMachineTargetVerifierResult;
  targetStateConsumptionResult?: PortableMachineTargetStateConsumptionResult;
  targetResourceStatuses?: PortableMachineTargetResourceStatus[];
  targetStackWindowMaterializationResult?: PortableMachineTargetNativePlanConsumptionResult;
  targetPrivateMemoryRestoreResult?: PortableMachineTargetNativePlanConsumptionResult;
  targetExecutableMappingResult?: PortableMachineTargetNativePlanConsumptionResult;
  targetSignalRestoreResult?: PortableMachineTargetNativePlanConsumptionResult;
  targetActiveSyscallRestoreResult?: PortableMachineTargetNativePlanConsumptionResult;
  targetReturnChainResult?: PortableMachineTargetReturnChainResult;
  targetTranslatedReturnAddress?: string;
  targetFrameRestoreResult?: PortableMachineTargetFrameRestoreResult;
  targetTranslatedFramePointer?: string;
  targetRegisterRestoreResult?: PortableMachineTargetRegisterRestoreResult;
  targetRflagsRestoreResult?: PortableMachineTargetRflagsRestoreResult;
  targetTlsRestoreResult?: PortableMachineTargetTlsRestoreResult;
  targetThreadRestoreResult?: PortableMachineTargetThreadRestoreResult;
  targetThreadRestoreThreadId?: string;
  targetResumePathResult?: PortableMachineTargetResumePathResult;
  targetResumePathMode?: string;
}

export interface PortableMachineVmRestoreProofPlan extends PortableMachineTargetRestoreObservation {
  phase: "portable-machine-vm-restore-proof";
  state: PortableMachineVmRestoreProofState;
  portableMachineBundle?: string;
  targetCodeFile?: string;
  targetImage?: string;
  sourceGuestArch?: "arm64";
  targetGuestArch?: "amd64";
  targetVmRequired: true;
  targetNativeCompletionRequired: true;
  migrationCompleted: boolean;
  descriptorGateCompleted: boolean;
  descriptorMemoryEntryCount?: number;
  descriptorFdRecipeCount?: number;
  descriptorResourceKinds?: string[];
  targetContinuationKind?: PortableMachineTargetContinuationKind;
  targetContinuationStatus?: string;
  targetContinuationReturnValue?: string;
  targetModuleBytesSource?: string;
  sourceTextReusedAsTargetCode: false;
  sourceIsaEmulationUsed: false;
  sidecarRuntimeUsed: false;
  refusal?: { code: string; message: string };
  skipReason?: string;
}

export interface PortableMachineVmRestoreTargetResult extends PortableMachineTargetRestoreObservation {
  exitCode: number;
  migrationCompleted?: boolean;
  descriptorGateCompleted?: boolean;
  actualResumeEvent?: { status?: string; returnValue?: string };
  sourceTextReusedAsTargetCode?: boolean;
  sourceIsaEmulationUsed?: boolean;
  sidecarRuntimeUsed?: boolean;
}

export interface PortableMachineTargetRestoreDescriptorRequest {
  continuation: TargetGuestRestoreContinuationDescriptor;
  translatedFrame?: TargetGuestTranslatedFrameDescriptor;
  fdTable: NativeTargetFdTablePlan;
  memory: TargetGuestMemoryMaterializationResult;
}

export type PortableMachineTargetRestoreDescriptorPlan =
  | {
      state: "ready";
      descriptor: TargetGuestRestoreDescriptor;
      refusals: [];
      memoryEntryCount: number;
      fdRecipeCount: number;
      sourceTextReusedAsTargetCode: false;
      sourceIsaEmulationUsed: false;
      sidecarRuntimeUsed: false;
    }
  | {
      state: "refused";
      refusals: NativeProcessImageRefusal[];
      memoryEntryCount: number;
      fdRecipeCount: number;
      sourceTextReusedAsTargetCode: false;
      sourceIsaEmulationUsed: false;
      sidecarRuntimeUsed: false;
    };

export function planPortableMachineTargetRestoreDescriptor(
  request: PortableMachineTargetRestoreDescriptorRequest,
): PortableMachineTargetRestoreDescriptorPlan {
  const refusals = [...request.fdTable.refusals, ...request.memory.refusals];
  const base = {
    memoryEntryCount: request.memory.entries.length,
    fdRecipeCount: request.fdTable.targetGuestResources.length,
    sourceTextReusedAsTargetCode: false as const,
    sourceIsaEmulationUsed: false as const,
    sidecarRuntimeUsed: false as const,
  };
  if (refusals.length > 0) {
    return { ...base, state: "refused", refusals };
  }
  return {
    ...base,
    state: "ready",
    refusals: [],
    descriptor: validateTargetGuestRestoreDescriptor({
      kind: TARGET_GUEST_RESTORE_DESCRIPTOR_KIND,
      targetArch: "amd64",
      continuation: request.continuation,
      translatedFrame: request.translatedFrame,
      resources: request.fdTable.targetGuestResources,
      memory: request.memory.entries,
    }),
  };
}

export function planPortableMachineVmRestoreProof(
  request: PortableMachineVmRestoreProofRequest,
): PortableMachineVmRestoreProofPlan {
  const missing = missingInputs(request);
  if (missing) {
    return skipped(missing);
  }
  const bundleDir = resolve(request.bundleDir!);
  const targetCodeFile = resolve(request.targetCodeFile!);
  if (!existsSync(bundleDir)) {
    return skipped("portable machine bundle is missing");
  }
  if (!existsSync(targetCodeFile)) {
    return skipped("target continuation bytes are missing");
  }
  if (!inside(bundleDir, targetCodeFile)) {
    return refused(
      "target-code-outside-portable-bundle",
      "target continuation must live inside the portable bundle",
    );
  }
  const bundle = validatePortableMachineSnapshotBundle(bundleDir);
  const sourceGuestArch = bundle.manifest.source.guestArch;
  const targetGuestArch = bundle.manifest.target.guestArch;
  if (sourceGuestArch !== "arm64" || targetGuestArch !== "amd64") {
    return refused(
      "proof-arch-pair-unsupported",
      "VM restore proof currently requires arm64->amd64",
    );
  }
  return {
    ...base(),
    state: "ready",
    portableMachineBundle: bundleDir,
    targetCodeFile,
    targetImage: request.targetImage ? resolve(request.targetImage) : undefined,
    migrationCompleted: false,
    sourceGuestArch,
    targetGuestArch,
  };
}

export function completePortableMachineVmRestoreProof(
  plan: PortableMachineVmRestoreProofPlan,
  result: PortableMachineVmRestoreTargetResult,
): PortableMachineVmRestoreProofPlan {
  const completed = targetNativeCompleted(result);
  return {
    ...plan,
    state: completed ? "completed" : plan.state,
    migrationCompleted: completed,
    descriptorGateCompleted: result.descriptorGateCompleted === true,
    targetVerifierResult: verifierResult(result, completed),
    targetContinuationStatus: result.actualResumeEvent?.status,
    targetContinuationReturnValue: result.actualResumeEvent?.returnValue,
    targetStateConsumptionResult: result.targetStateConsumptionResult,
    targetResourceStatuses: result.targetResourceStatuses,
    targetStackWindowMaterializationResult: result.targetStackWindowMaterializationResult,
    targetPrivateMemoryRestoreResult: result.targetPrivateMemoryRestoreResult,
    targetExecutableMappingResult: result.targetExecutableMappingResult,
    targetSignalRestoreResult: result.targetSignalRestoreResult,
    targetActiveSyscallRestoreResult: result.targetActiveSyscallRestoreResult,
    targetReturnChainResult: result.targetReturnChainResult,
    targetTranslatedReturnAddress: result.targetTranslatedReturnAddress,
    targetFrameRestoreResult: result.targetFrameRestoreResult,
    targetTranslatedFramePointer: result.targetTranslatedFramePointer,
    targetRegisterRestoreResult: result.targetRegisterRestoreResult,
    targetRflagsRestoreResult: result.targetRflagsRestoreResult,
    targetTlsRestoreResult: result.targetTlsRestoreResult,
    targetThreadRestoreResult: result.targetThreadRestoreResult ?? plan.targetThreadRestoreResult,
    targetThreadRestoreThreadId:
      result.targetThreadRestoreThreadId ?? plan.targetThreadRestoreThreadId,
    targetResumePathResult: result.targetResumePathResult,
    targetResumePathMode: result.targetResumePathMode,
  };
}

function verifierResult(
  result: PortableMachineVmRestoreTargetResult,
  completed: boolean,
): PortableMachineTargetVerifierResult {
  return result.targetVerifierResult ?? (completed ? "passed" : "failed");
}

function targetNativeCompleted(result: PortableMachineVmRestoreTargetResult): boolean {
  return [
    result.exitCode === 0,
    result.migrationCompleted === true,
    result.descriptorGateCompleted === true,
    optionalTargetChecksPassed(result),
    result.sourceTextReusedAsTargetCode === false,
    result.sourceIsaEmulationUsed === false,
    result.sidecarRuntimeUsed === false,
  ].every(Boolean);
}

function optionalTargetChecksPassed(result: PortableMachineVmRestoreTargetResult): boolean {
  return [
    passedOrUnset(result.targetVerifierResult),
    passedOrUnset(result.targetStateConsumptionResult),
    passedOrUnset(result.targetStackWindowMaterializationResult),
    passedOrUnset(result.targetPrivateMemoryRestoreResult),
    passedOrUnset(result.targetExecutableMappingResult),
    passedOrUnset(result.targetSignalRestoreResult),
    passedOrUnset(result.targetActiveSyscallRestoreResult),
    passedOrUnset(result.targetReturnChainResult),
    passedOrUnset(result.targetFrameRestoreResult),
    passedOrUnset(result.targetRegisterRestoreResult),
    passedOrUnset(result.targetRflagsRestoreResult),
    passedOrUnset(result.targetTlsRestoreResult),
    result.targetThreadRestoreResult === undefined ||
      result.targetThreadRestoreResult === "accepted",
    passedOrUnset(result.targetResumePathResult),
  ].every(Boolean);
}

function passedOrUnset(value: string | undefined): boolean {
  return value === undefined || value === "passed";
}

function missingInputs(request: PortableMachineVmRestoreProofRequest): string | undefined {
  if (!request.bundleDir) {
    return "--bundle-dir is required";
  }
  if (!request.targetCodeFile) {
    return "--target-code-file is required";
  }
  return undefined;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/");
}

function base(): Omit<
  PortableMachineVmRestoreProofPlan,
  "state" | "migrationCompleted" | "portableMachineBundle" | "targetCodeFile"
> {
  return {
    phase: "portable-machine-vm-restore-proof",
    targetVmRequired: true,
    targetNativeCompletionRequired: true,
    descriptorGateCompleted: false,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
  };
}

function skipped(reason: string): PortableMachineVmRestoreProofPlan {
  return { ...base(), state: "skipped", migrationCompleted: false, skipReason: reason };
}

function refused(code: string, message: string): PortableMachineVmRestoreProofPlan {
  return { ...base(), state: "refused", migrationCompleted: false, refusal: { code, message } };
}
