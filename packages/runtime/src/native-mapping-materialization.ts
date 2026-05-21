/** Target mapping materialization planning for native process images. */

import type { NativeMemoryMapping, NativeProcessImageRefusal } from "./native-process-image.ts";

export type NativeMappingMaterializationAction =
  | "map-target-file"
  | "copy-captured-bytes"
  | "recreate"
  | "omit"
  | "refuse";

export interface NativeMappingMaterializationStep {
  mapping: string;
  kind: NativeMemoryMapping["kind"];
  action: NativeMappingMaterializationAction;
  targetStart?: string;
  sizeBytes: number;
  permissions: NativeMemoryMapping["permissions"];
  targetFile?: {
    path: string;
    offset: number;
    buildId?: string;
    sha256?: string;
  };
  sourceBytes?: {
    offset: number;
    sizeBytes: number;
  };
  refusal?: NativeProcessImageRefusal;
}

export interface NativeMappingMaterializationRequest {
  mappings: NativeMemoryMapping[];
  memorySizeBytes: number;
  targetFileBuildIds?: Record<string, string>;
}

export interface NativeMappingMaterializationResult {
  steps: NativeMappingMaterializationStep[];
  refusals: NativeProcessImageRefusal[];
}

export function planNativeMappingMaterialization(
  request: NativeMappingMaterializationRequest,
): NativeMappingMaterializationResult {
  const steps = request.mappings.map((mapping) => planMapping(mapping, request));
  return {
    steps,
    refusals: steps.flatMap((step) => (step.refusal ? [step.refusal] : [])),
  };
}

function planMapping(
  mapping: NativeMemoryMapping,
  request: NativeMappingMaterializationRequest,
): NativeMappingMaterializationStep {
  if (mapping.target.materialization === "refuse") {
    return refusedPolicyStep(mapping);
  }

  const permissionRefusal = validatePermissions(mapping);
  if (permissionRefusal) {
    return refusedStep(mapping, permissionRefusal);
  }

  switch (mapping.target.materialization) {
    case "translate":
      return translatedStep(mapping, request);
    case "recreate":
      return recreatedStep(mapping);
    case "omit":
      return baseStep(mapping, "omit");
  }
}

function translatedStep(
  mapping: NativeMemoryMapping,
  request: NativeMappingMaterializationRequest,
): NativeMappingMaterializationStep {
  const targetRefusal = validateTargetStart(mapping);
  if (targetRefusal) {
    return refusedStep(mapping, targetRefusal);
  }
  if (mapping.permissions.execute && mapping.file) {
    const buildRefusal = validateTargetFileBuild(mapping, request.targetFileBuildIds ?? {});
    if (buildRefusal) {
      return refusedStep(mapping, buildRefusal);
    }
    return { ...baseStep(mapping, "map-target-file"), targetFile: mapping.file };
  }

  const bytesRefusal = validateCapturedBytes(mapping, request.memorySizeBytes);
  if (bytesRefusal) {
    return refusedStep(mapping, bytesRefusal);
  }
  return {
    ...baseStep(mapping, "copy-captured-bytes"),
    sourceBytes: {
      offset: mapping.captured!.offset,
      sizeBytes: mapping.captured!.sizeBytes,
    },
  };
}

function refusedPolicyStep(mapping: NativeMemoryMapping): NativeMappingMaterializationStep {
  const reason =
    mapping.refusal ?? refusal("mapping-ambiguous", `${mapping.id} is refused without a reason`);
  if (reason.code === "mapping-unreadable" && isRecreatableNoAccessProtectionMapping(mapping)) {
    return noAccessProtectionRecreatedStep(mapping);
  }
  if (reason.code === "mapping-unreadable") {
    return refusedStep(mapping, withMappingDetail(mapping, reason));
  }
  return refusedStep(mapping, reason);
}

function recreatedStep(mapping: NativeMemoryMapping): NativeMappingMaterializationStep {
  if (mapping.captured) {
    return refusedStep(
      mapping,
      refusal(
        "mapping-ambiguous",
        `${mapping.id} is target-recreated but still has captured bytes`,
      ),
    );
  }
  return baseStep(mapping, "recreate");
}

function noAccessProtectionRecreatedStep(
  mapping: NativeMemoryMapping,
): NativeMappingMaterializationStep {
  return {
    ...baseStep(mapping, "recreate"),
    targetStart: mapping.target.targetStart ?? mapping.sourceStart,
  };
}

function baseStep(
  mapping: NativeMemoryMapping,
  action: NativeMappingMaterializationAction,
): NativeMappingMaterializationStep {
  return {
    mapping: mapping.id,
    kind: mapping.kind,
    action,
    targetStart: mapping.target.targetStart,
    sizeBytes: mapping.sizeBytes,
    permissions: mapping.permissions,
  };
}

function refusedStep(
  mapping: NativeMemoryMapping,
  reason: NativeProcessImageRefusal,
): NativeMappingMaterializationStep {
  return { ...baseStep(mapping, "refuse"), refusal: reason };
}

function validatePermissions(mapping: NativeMemoryMapping): NativeProcessImageRefusal | undefined {
  if (mapping.permissions.write && mapping.permissions.execute) {
    return refusal("mapping-permission-unsupported", `${mapping.id} is writable and executable`);
  }
  return undefined;
}

function isRecreatableNoAccessProtectionMapping(mapping: NativeMemoryMapping): boolean {
  return (
    noAccessPrivate(mapping) &&
    !mapping.captured &&
    ["anonymous", "stack", "file"].includes(mapping.kind)
  );
}

function noAccessPrivate(mapping: NativeMemoryMapping): boolean {
  return [
    !mapping.permissions.read,
    !mapping.permissions.write,
    !mapping.permissions.execute,
    mapping.permissions.private,
    !mapping.permissions.shared,
  ].every(Boolean);
}

function withMappingDetail(
  mapping: NativeMemoryMapping,
  reason: NativeProcessImageRefusal,
): NativeProcessImageRefusal {
  return {
    ...reason,
    detail: {
      ...reason.detail,
      mapping: mapping.id,
      kind: mapping.kind,
      sourceStart: mapping.sourceStart,
      sourceEnd: mapping.sourceEnd,
      sizeBytes: mapping.sizeBytes,
      perms: permissionString(mapping),
      path: mapping.file?.path ?? "",
      permissions: mapping.permissions,
    },
  };
}

function permissionString(mapping: NativeMemoryMapping): string {
  return `${mapping.permissions.read ? "r" : "-"}${mapping.permissions.write ? "w" : "-"}${
    mapping.permissions.execute ? "x" : "-"
  }${mapping.permissions.shared ? "s" : mapping.permissions.private ? "p" : "-"}`;
}

function validateTargetStart(mapping: NativeMemoryMapping): NativeProcessImageRefusal | undefined {
  if (mapping.target.targetStart) {
    return undefined;
  }
  return refusal("mapping-ambiguous", `${mapping.id} has no target start address`);
}

function validateTargetFileBuild(
  mapping: NativeMemoryMapping,
  targetFileBuildIds: Record<string, string>,
): NativeProcessImageRefusal | undefined {
  const expected = mapping.file?.buildId;
  const actual = mapping.file ? targetFileBuildIds[mapping.file.path] : undefined;
  if (!expected || !actual || normalizeBuildId(expected) === normalizeBuildId(actual)) {
    return undefined;
  }
  return {
    code: "target-build-mismatch",
    message: `${mapping.id} target file build ${actual} does not match expected ${expected}`,
    detail: {
      mapping: mapping.id,
      path: mapping.file!.path,
      targetBuildId: actual,
      expectedTargetBuildId: expected,
    },
  };
}

function validateCapturedBytes(
  mapping: NativeMemoryMapping,
  memorySizeBytes: number,
): NativeProcessImageRefusal | undefined {
  if (!mapping.captured) {
    return refusal("mapping-ambiguous", `${mapping.id} needs captured bytes to translate`);
  }
  const end = mapping.captured.offset + mapping.captured.sizeBytes;
  if (mapping.captured.sizeBytes !== mapping.sizeBytes || end > memorySizeBytes) {
    return refusal("mapping-ambiguous", `${mapping.id} captured byte range is invalid`);
  }
  return undefined;
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeProcessImageRefusal {
  return { code, message };
}

function normalizeBuildId(value: string): string {
  return value.toLowerCase();
}
