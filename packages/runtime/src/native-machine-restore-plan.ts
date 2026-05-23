import {
  planNativeMappingMaterialization,
  type NativeMappingMaterializationRequest,
  type NativeMappingMaterializationResult,
} from "./native-mapping-materialization.ts";
import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import {
  planNativeReturnChain,
  type NativeReturnChainPlan,
  type NativeReturnChainPlanRequest,
} from "./native-return-chain.ts";
import {
  planNativeStackWindowMaterialization,
  type NativeStackWindowMaterializationPlan,
  type NativeStackWindowMaterializationRequest,
} from "./native-stack-translation.ts";
import {
  planNativeThreadRestoreBoundary,
  type NativeThreadRestorePlan,
  type NativeThreadRestorePlanRequest,
} from "./native-thread-restore-policy.ts";

export interface NativeMachineRestorePlanRequest {
  thread: NativeThreadRestorePlanRequest;
  stackWindow?: NativeStackWindowMaterializationRequest;
  returnChain?: NativeReturnChainPlanRequest;
  mappings?: NativeMappingMaterializationRequest;
}

export type NativeMachineRestorePlan =
  | {
      state: "accepted";
      thread: Extract<NativeThreadRestorePlan, { state: "accepted" }>;
      stackWindow?: NativeStackWindowMaterializationPlan & { state: "materialized" };
      returnChain?: NativeReturnChainPlan & { state: "materialized" };
      mappings?: NativeMappingMaterializationResult;
      refusals: [];
    }
  | {
      state: "refused";
      thread: NativeThreadRestorePlan;
      stackWindow?: NativeStackWindowMaterializationPlan;
      returnChain?: NativeReturnChainPlan;
      mappings?: NativeMappingMaterializationResult;
      refusals: NativeProcessImageRefusal[];
    };

export function planNativeMachineRestore(
  request: NativeMachineRestorePlanRequest,
): NativeMachineRestorePlan {
  const thread = planNativeThreadRestoreBoundary(request.thread);
  const stackWindow = request.stackWindow
    ? planNativeStackWindowMaterialization(request.stackWindow)
    : undefined;
  const returnChain = request.returnChain ? planNativeReturnChain(request.returnChain) : undefined;
  const mappings = request.mappings
    ? planNativeMappingMaterialization(request.mappings)
    : undefined;
  const refusals = aggregateRefusals(thread, stackWindow, returnChain, mappings);

  if (refusals.length > 0 || thread.state !== "accepted") {
    return { state: "refused", thread, stackWindow, returnChain, mappings, refusals };
  }
  return {
    state: "accepted",
    thread,
    stackWindow: materializedStackWindow(stackWindow),
    returnChain: materializedReturnChain(returnChain),
    mappings,
    refusals: [],
  };
}

function aggregateRefusals(
  thread: NativeThreadRestorePlan,
  stackWindow: NativeStackWindowMaterializationPlan | undefined,
  returnChain: NativeReturnChainPlan | undefined,
  mappings: NativeMappingMaterializationResult | undefined,
): NativeProcessImageRefusal[] {
  return [
    ...thread.refusals,
    ...(stackWindow?.refusals ?? []),
    ...(returnChain?.refusals ?? []),
    ...(mappings?.refusals ?? []),
  ];
}

function materializedStackWindow(
  plan: NativeStackWindowMaterializationPlan | undefined,
): (NativeStackWindowMaterializationPlan & { state: "materialized" }) | undefined {
  return plan?.state === "materialized" ? { ...plan, state: "materialized" } : undefined;
}

function materializedReturnChain(
  plan: NativeReturnChainPlan | undefined,
): (NativeReturnChainPlan & { state: "materialized" }) | undefined {
  return plan?.state === "materialized" ? { ...plan, state: "materialized" } : undefined;
}
