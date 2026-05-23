import type { NativeMappingMaterializationStep } from "./native-mapping-materialization.ts";
import type { NativeMemoryMapping, NativeProcessImageRefusal } from "./native-process-image.ts";

export interface TargetGuestExecutableMappingStep {
  action: "map-target-executable";
  mapping: string;
  targetStart: string;
  sizeBytes: number;
  permissions: NativeMemoryMapping["permissions"];
  path: string;
  fileOffset: number;
  buildId?: string;
  sha256?: string;
  sourceTextReusedAsTargetCode: false;
}

export interface TargetGuestExecutableMaterializationPlan {
  state: "planned" | "refused";
  steps: TargetGuestExecutableMappingStep[];
  refusals: NativeProcessImageRefusal[];
}

export function planTargetGuestExecutableMaterialization(
  steps: NativeMappingMaterializationStep[],
): TargetGuestExecutableMaterializationPlan {
  const planned = steps.map((step) => planStep(step));
  const refusals = planned.flatMap((item) => (item.refusal ? [item.refusal] : []));
  return {
    state: refusals.length === 0 ? "planned" : "refused",
    steps: planned.flatMap((item) => (item.step ? [item.step] : [])),
    refusals,
  };
}

function planStep(step: NativeMappingMaterializationStep): {
  step?: TargetGuestExecutableMappingStep;
  refusal?: NativeProcessImageRefusal;
} {
  if (!step.permissions.execute) {
    return {};
  }
  if (step.action === "copy-captured-bytes" || step.sourceBytes) {
    return {
      refusal: refusal(
        "mapping-executable-unsupported",
        `${step.mapping} would reuse captured source executable bytes`,
      ),
    };
  }
  if (step.action !== "map-target-file") {
    return {
      refusal: refusal(
        "mapping-provenance-ambiguous",
        `${step.mapping} executable mapping is not backed by a target file`,
      ),
    };
  }
  if (!step.targetStart || !step.targetFile) {
    return {
      refusal: refusal(
        "mapping-provenance-ambiguous",
        `${step.mapping} executable mapping is missing target file provenance`,
      ),
    };
  }
  if (!step.targetFile.buildId && !step.targetFile.sha256) {
    return {
      refusal: refusal(
        "mapping-provenance-ambiguous",
        `${step.mapping} target executable mapping needs build-id or sha256 provenance`,
      ),
    };
  }
  return {
    step: {
      action: "map-target-executable",
      mapping: step.mapping,
      targetStart: step.targetStart,
      sizeBytes: step.sizeBytes,
      permissions: step.permissions,
      path: step.targetFile.path,
      fileOffset: step.targetFile.offset,
      buildId: step.targetFile.buildId,
      sha256: step.targetFile.sha256,
      sourceTextReusedAsTargetCode: false,
    },
  };
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeProcessImageRefusal {
  return { code, message };
}
