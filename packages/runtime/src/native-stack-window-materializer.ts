import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type { NativeMemoryRelocation } from "./native-process-image.ts";
import type { NativeStackWindowMaterializationPlan } from "./native-stack-translation.ts";

export interface NativeStackWindowWrite {
  mapping: string;
  targetAddress: string;
  offset: number;
  sizeBytes: 8;
  value: string;
  bytes: string;
  kind: NativeMemoryRelocation["kind"];
}

export interface NativeStackWindowGuardMapping {
  targetStart: string;
  sizeBytes: number;
  placement: "below" | "above";
}

export type NativeStackWindowMaterializedWrites =
  | {
      state: "materialized";
      stackMapping: string;
      targetWindow: NativeStackWindowMaterializationPlan["targetWindow"];
      writes: NativeStackWindowWrite[];
      guards: NativeStackWindowGuardMapping[];
      refusals: [];
    }
  | {
      state: "refused";
      stackMapping: string;
      refusals: NativeProcessImageRefusal[];
    };

export function materializeNativeStackWindowWrites(
  plan: NativeStackWindowMaterializationPlan,
): NativeStackWindowMaterializedWrites {
  if (plan.state !== "materialized") {
    return { state: "refused", stackMapping: plan.stackMapping, refusals: plan.refusals };
  }
  const writes = plan.relocations.flatMap((relocation) => relocationWrite(plan, relocation));
  return {
    state: "materialized",
    stackMapping: plan.stackMapping,
    targetWindow: plan.targetWindow,
    writes,
    guards: stackGuardMappings(plan),
    refusals: [],
  };
}

function relocationWrite(
  plan: NativeStackWindowMaterializationPlan,
  relocation: NativeMemoryRelocation,
): NativeStackWindowWrite[] {
  if (relocation.state !== "translated" || relocation.targetValue === undefined) {
    return [];
  }
  const offset = relocation.offset;
  const targetAddress = `0x${(BigInt(plan.targetWindow.base) + BigInt(offset)).toString(16)}`;
  return [
    {
      mapping: relocation.mapping,
      targetAddress,
      offset,
      sizeBytes: 8,
      value: relocation.targetValue,
      bytes: littleEndianU64Hex(relocation.targetValue),
      kind: relocation.kind,
    },
  ];
}

function stackGuardMappings(
  plan: NativeStackWindowMaterializationPlan,
): NativeStackWindowGuardMapping[] {
  const targetBase = BigInt(plan.targetWindow.base);
  const targetLimit = BigInt(plan.targetWindow.limit);
  const below = BigInt(plan.guards.below);
  const above = BigInt(plan.guards.above);
  return [
    { targetStart: plan.guards.below, sizeBytes: Number(targetBase - below), placement: "below" },
    {
      targetStart: plan.targetWindow.limit,
      sizeBytes: Number(above - targetLimit),
      placement: "above",
    },
  ];
}

function littleEndianU64Hex(value: string): string {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes.toString("hex");
}
