/** Target-native frame-state materialization planning. */

import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type {
  NativeTargetCalleeSavedSlot,
  NativeTargetUnwindFrameMatch,
  NativeTargetUnwindMatchResult,
  NativeTargetUnwindRegister,
} from "./native-target-unwind.ts";

export type NativeTargetFrameStateRegister = Exclude<NativeTargetUnwindRegister, "rsp" | "rip">;
export type NativeTargetFrameStateValueSource = "target-register" | "synthetic-target-caller";

export interface NativeSyntheticTargetCallerFrameStatePolicy {
  mode: "abi-neutral-sentinel";
  value?: string;
}

export interface NativeTargetFrameRegisterValue {
  register: NativeTargetFrameStateRegister;
  value: string;
  source: NativeTargetFrameStateValueSource;
}

export interface NativeTargetFrameStateRequirement {
  sourceFrameId: string;
  targetAddress: string;
  register: NativeTargetFrameStateRegister;
  slot: NativeTargetCalleeSavedSlot;
}

export interface NativeTargetFrameStateMaterialization {
  requirement: NativeTargetFrameStateRequirement;
  value: string;
  valueSource: NativeTargetFrameStateValueSource;
}

export interface NativeTargetFrameStateMaterializationRequest {
  targetUnwind: NativeTargetUnwindMatchResult;
  registerValues?: NativeTargetFrameRegisterValue[];
  syntheticTargetCaller?: NativeSyntheticTargetCallerFrameStatePolicy;
}

export interface NativeTargetFrameStateMaterializationResult {
  requirements: NativeTargetFrameStateRequirement[];
  materialized: NativeTargetFrameStateMaterialization[];
  refusals: NativeProcessImageRefusal[];
}

export function planNativeTargetFrameStateMaterialization(
  request: NativeTargetFrameStateMaterializationRequest,
): NativeTargetFrameStateMaterializationResult {
  const requirements = targetFrameStateRequirements(request.targetUnwind.matches);
  const values = registerValueMap(request.registerValues ?? []);
  const materialized: NativeTargetFrameStateMaterialization[] = [];
  const refusals: NativeProcessImageRefusal[] = [];

  for (const requirement of requirements) {
    const value = values.get(requirement.register);
    if (value) {
      materialized.push({ requirement, value: value.value, valueSource: value.source });
      continue;
    }
    if (request.syntheticTargetCaller) {
      materialized.push(syntheticCallerMaterialization(requirement, request.syntheticTargetCaller));
      continue;
    }
    refusals.push(missingRegisterValueRefusal(requirement));
  }

  return { requirements, materialized, refusals };
}

function targetFrameStateRequirements(
  matches: NativeTargetUnwindFrameMatch[],
): NativeTargetFrameStateRequirement[] {
  return matches.flatMap((match) =>
    (match.targetCalleeSavedSlots ?? []).map((slot) => requirementFromSlot(match, slot)),
  );
}

function requirementFromSlot(
  match: NativeTargetUnwindFrameMatch,
  slot: NativeTargetCalleeSavedSlot,
): NativeTargetFrameStateRequirement {
  return {
    sourceFrameId: match.sourceFrameId,
    targetAddress: match.targetAddress,
    register: slot.register,
    slot,
  };
}

function registerValueMap(values: NativeTargetFrameRegisterValue[]) {
  return new Map(values.map((value) => [value.register, value]));
}

function syntheticCallerMaterialization(
  requirement: NativeTargetFrameStateRequirement,
  policy: NativeSyntheticTargetCallerFrameStatePolicy,
): NativeTargetFrameStateMaterialization {
  return {
    requirement,
    value: policy.value ?? "0x0",
    valueSource: "synthetic-target-caller",
  };
}

function missingRegisterValueRefusal(
  requirement: NativeTargetFrameStateRequirement,
): NativeProcessImageRefusal {
  return {
    code: "target-frame-register-value-unavailable",
    message: `target callee-saved ${requirement.register} value is unavailable for frame-state materialization`,
    detail: {
      sourceFrameId: requirement.sourceFrameId,
      targetAddress: requirement.targetAddress,
      register: requirement.register,
      slot: requirement.slot,
    },
  };
}
