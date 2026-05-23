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
  privateWritable?: {
    guardMappings: string[];
  };
  refusal?: NativeProcessImageRefusal;
}

export interface NativePrivateWritableGuardRequest {
  mapping: string;
  belowMapping?: string;
  aboveMapping?: string;
}

export interface NativeMappingMaterializationRequest {
  mappings: NativeMemoryMapping[];
  memorySizeBytes: number;
  targetFileBuildIds?: Record<string, string>;
  privateWritableGuards?: NativePrivateWritableGuardRequest[];
}

export interface NativeMappingMaterializationResult {
  steps: NativeMappingMaterializationStep[];
  refusals: NativeProcessImageRefusal[];
}

export function planNativeMappingMaterialization(
  request: NativeMappingMaterializationRequest,
): NativeMappingMaterializationResult {
  const plannedSteps = request.mappings.map((mapping) => planMapping(mapping, request));
  const steps = attachPrivateWritableGuards(plannedSteps, request.privateWritableGuards ?? []);
  return {
    steps,
    refusals: [
      ...steps.flatMap((step) => (step.refusal ? [step.refusal] : [])),
      ...validatePrivateWritableGuards(steps, request.privateWritableGuards ?? []),
    ],
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

  const privateWritableRefusal = validatePrivateWritable(mapping);
  if (privateWritableRefusal) {
    return refusedStep(mapping, privateWritableRefusal);
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
    ...privateWritableStep(mapping),
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

function privateWritableStep(
  mapping: NativeMemoryMapping,
): Pick<NativeMappingMaterializationStep, "privateWritable"> | Record<string, never> {
  return isPrivateWritableMapping(mapping) ? { privateWritable: { guardMappings: [] } } : {};
}

function attachPrivateWritableGuards(
  steps: NativeMappingMaterializationStep[],
  guards: NativePrivateWritableGuardRequest[],
): NativeMappingMaterializationStep[] {
  const guardMappings = new Map(
    guards.map((guard) => [
      guard.mapping,
      [guard.belowMapping, guard.aboveMapping].flatMap((id) => (id ? [id] : [])),
    ]),
  );
  return steps.map((step) => {
    const mappingGuards = guardMappings.get(step.mapping);
    return step.privateWritable && mappingGuards
      ? { ...step, privateWritable: { guardMappings: mappingGuards } }
      : step;
  });
}

function validatePrivateWritableGuards(
  steps: NativeMappingMaterializationStep[],
  guards: NativePrivateWritableGuardRequest[],
): NativeProcessImageRefusal[] {
  const byId = new Map(steps.map((step) => [step.mapping, step]));
  return guards.flatMap((guard) => validatePrivateWritableGuardRequest(guard, byId));
}

function validatePrivateWritableGuardRequest(
  guard: NativePrivateWritableGuardRequest,
  steps: Map<string, NativeMappingMaterializationStep>,
): NativeProcessImageRefusal[] {
  const mapping = steps.get(guard.mapping);
  if (!mapping || !mapping.privateWritable || mapping.action !== "copy-captured-bytes") {
    return [
      refusal("mapping-ambiguous", `${guard.mapping} is not a copied private writable mapping`),
    ];
  }
  return [
    ...validateOnePrivateWritableGuard(mapping, guard.belowMapping, "below", steps),
    ...validateOnePrivateWritableGuard(mapping, guard.aboveMapping, "above", steps),
  ];
}

function validateOnePrivateWritableGuard(
  mapping: NativeMappingMaterializationStep,
  guardMapping: string | undefined,
  placement: "below" | "above",
  steps: Map<string, NativeMappingMaterializationStep>,
): NativeProcessImageRefusal[] {
  if (guardMapping === undefined) {
    return [];
  }
  const guard = steps.get(guardMapping);
  if (!guard || guard.action !== "recreate" || !noAccessPermissions(guard.permissions)) {
    return [refusal("mapping-ambiguous", `${guardMapping} is not a recreated no-access guard`)];
  }
  return guardIsAdjacent(mapping, guard, placement)
    ? []
    : [refusal("mapping-ambiguous", `${guardMapping} is not adjacent to ${mapping.mapping}`)];
}

function guardIsAdjacent(
  mapping: NativeMappingMaterializationStep,
  guard: NativeMappingMaterializationStep,
  placement: "below" | "above",
): boolean {
  if (!mapping.targetStart || !guard.targetStart) {
    return false;
  }
  const mappingStart = BigInt(mapping.targetStart);
  const mappingEnd = mappingStart + BigInt(mapping.sizeBytes);
  const guardStart = BigInt(guard.targetStart);
  const guardEnd = guardStart + BigInt(guard.sizeBytes);
  return placement === "below" ? guardEnd === mappingStart : guardStart === mappingEnd;
}

function validatePermissions(mapping: NativeMemoryMapping): NativeProcessImageRefusal | undefined {
  if (mapping.permissions.write && mapping.permissions.execute) {
    return refusal("mapping-permission-unsupported", `${mapping.id} is writable and executable`);
  }
  return undefined;
}

function validatePrivateWritable(
  mapping: NativeMemoryMapping,
): NativeProcessImageRefusal | undefined {
  if (!mapping.permissions.write) {
    return undefined;
  }
  if (!mapping.permissions.private || mapping.permissions.shared) {
    return refusal("mapping-shared-unsupported", `${mapping.id} is writable shared memory`);
  }
  if (!isPrivateWritableMapping(mapping)) {
    return refusal(
      "mapping-permission-unsupported",
      `${mapping.id} writable permissions are ambiguous`,
    );
  }
  return undefined;
}

function isPrivateWritableMapping(mapping: NativeMemoryMapping): boolean {
  return [
    mapping.permissions.write,
    mapping.permissions.private,
    !mapping.permissions.shared,
    !mapping.permissions.execute,
  ].every(Boolean);
}

function isRecreatableNoAccessProtectionMapping(mapping: NativeMemoryMapping): boolean {
  return (
    noAccessPrivate(mapping) &&
    !mapping.captured &&
    ["anonymous", "stack", "file"].includes(mapping.kind)
  );
}

function noAccessPrivate(mapping: NativeMemoryMapping): boolean {
  return noAccessPermissions(mapping.permissions);
}

function noAccessPermissions(permissions: NativeMemoryMapping["permissions"]): boolean {
  return [
    !permissions.read,
    !permissions.write,
    !permissions.execute,
    permissions.private,
    !permissions.shared,
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
    return refusal(
      isPrivateWritableMapping(mapping)
        ? "mapping-captured-range-unsupported"
        : "mapping-ambiguous",
      `${mapping.id} needs captured bytes to translate`,
    );
  }
  const end = mapping.captured.offset + mapping.captured.sizeBytes;
  if (mapping.captured.sizeBytes !== mapping.sizeBytes || end > memorySizeBytes) {
    return refusal(
      isPrivateWritableMapping(mapping)
        ? "mapping-captured-range-unsupported"
        : "mapping-ambiguous",
      `${mapping.id} captured byte range is invalid`,
    );
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
