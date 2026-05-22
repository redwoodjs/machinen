import {
  NATIVE_PROCESS_IMAGE_FILES,
  type NativeMemoryMapping,
  type NativeProcessImageRefusal,
} from "./native-process-image.ts";

export type TargetGuestMemoryMaterializationKind = "copy-captured-bytes" | "recreate-guard";

interface TargetGuestMemoryMaterializationEntryBase {
  kind: TargetGuestMemoryMaterializationKind;
  mapping: string;
  targetStart: string;
  sizeBytes: number;
  permissions: string;
  provenance: "native-process-image" | "guard-protection";
}

export interface TargetGuestCopyCapturedBytesEntry extends TargetGuestMemoryMaterializationEntryBase {
  kind: "copy-captured-bytes";
  sourceFile: string;
  sourceOffset: number;
  provenance: "native-process-image";
}

export interface TargetGuestRecreateGuardEntry extends TargetGuestMemoryMaterializationEntryBase {
  kind: "recreate-guard";
  provenance: "guard-protection";
}

export type TargetGuestMemoryMaterializationEntry =
  | TargetGuestCopyCapturedBytesEntry
  | TargetGuestRecreateGuardEntry;

export interface TargetGuestMemoryMaterializationRequest {
  mappings: NativeMemoryMapping[];
  memorySizeBytes: number;
  memoryFile: string;
}

export interface TargetGuestMemoryMaterializationResult {
  entries: TargetGuestMemoryMaterializationEntry[];
  refusals: NativeProcessImageRefusal[];
}

export function planTargetGuestMemoryMaterialization(
  request: TargetGuestMemoryMaterializationRequest,
): TargetGuestMemoryMaterializationResult {
  const planned = request.mappings.map((mapping) => planMapping(mapping, request));
  const entries = planned.flatMap((item) => (item.entry ? [item.entry] : []));
  return {
    entries,
    refusals: [...planned.flatMap((item) => item.refusals), ...overlapRefusals(entries)],
  };
}

function planMapping(
  mapping: NativeMemoryMapping,
  request: TargetGuestMemoryMaterializationRequest,
): { entry?: TargetGuestMemoryMaterializationEntry; refusals: NativeProcessImageRefusal[] } {
  const unsafe = unsafeMappingRefusal(mapping);
  if (unsafe) {
    return refused(unsafe);
  }
  if (isGuardMapping(mapping)) {
    return guardEntry(mapping);
  }
  if (isWritableTranslateMapping(mapping)) {
    return writableEntry(mapping, request);
  }
  return { refusals: [] };
}

function writableEntry(
  mapping: NativeMemoryMapping,
  request: TargetGuestMemoryMaterializationRequest,
): { entry?: TargetGuestCopyCapturedBytesEntry; refusals: NativeProcessImageRefusal[] } {
  const invalid = validateWritableMapping(mapping, request.memorySizeBytes);
  if (invalid.length > 0) {
    return { refusals: invalid };
  }
  return {
    entry: {
      kind: "copy-captured-bytes",
      mapping: mapping.id,
      targetStart: mapping.target.targetStart!,
      sizeBytes: mapping.sizeBytes,
      permissions: permissionString(mapping),
      sourceFile: request.memoryFile,
      sourceOffset: mapping.captured!.offset,
      provenance: "native-process-image",
    },
    refusals: [],
  };
}

function guardEntry(mapping: NativeMemoryMapping): {
  entry?: TargetGuestRecreateGuardEntry;
  refusals: NativeProcessImageRefusal[];
} {
  const targetStart = mapping.target.targetStart ?? mapping.sourceStart;
  return {
    entry: {
      kind: "recreate-guard",
      mapping: mapping.id,
      targetStart,
      sizeBytes: mapping.sizeBytes,
      permissions: permissionString(mapping),
      provenance: "guard-protection",
    },
    refusals: [],
  };
}

function validateWritableMapping(
  mapping: NativeMemoryMapping,
  memorySizeBytes: number,
): NativeProcessImageRefusal[] {
  return [
    missingTargetStartRefusal(mapping),
    capturedProvenanceRefusal(mapping),
    capturedRangeRefusal(mapping, memorySizeBytes),
  ].filter((refusal) => refusal !== undefined);
}

function missingTargetStartRefusal(
  mapping: NativeMemoryMapping,
): NativeProcessImageRefusal | undefined {
  return mapping.target.targetStart
    ? undefined
    : refusal("mapping-ambiguous", `${mapping.id} has no target start address`);
}

function capturedProvenanceRefusal(
  mapping: NativeMemoryMapping,
): NativeProcessImageRefusal | undefined {
  const captured = mapping.captured;
  if (!captured) {
    return refusal("mapping-provenance-ambiguous", `${mapping.id} has no captured bytes`);
  }
  return captured.file === NATIVE_PROCESS_IMAGE_FILES.memory
    ? undefined
    : refusal(
        "mapping-provenance-ambiguous",
        `${mapping.id} captured bytes must come from ${NATIVE_PROCESS_IMAGE_FILES.memory}`,
        { mapping: mapping.id, capturedFile: captured.file },
      );
}

function capturedRangeRefusal(
  mapping: NativeMemoryMapping,
  memorySizeBytes: number,
): NativeProcessImageRefusal | undefined {
  const captured = mapping.captured;
  if (!captured) {
    return undefined;
  }
  const end = captured.offset + captured.sizeBytes;
  if (captured.offset < 0 || captured.sizeBytes !== mapping.sizeBytes || end > memorySizeBytes) {
    return refusal(
      "mapping-captured-range-unsupported",
      `${mapping.id} captured byte range does not exactly cover the mapping`,
      { mapping: mapping.id, offset: captured.offset, sizeBytes: captured.sizeBytes },
    );
  }
  return undefined;
}

function overlapRefusals(
  entries: TargetGuestMemoryMaterializationEntry[],
): NativeProcessImageRefusal[] {
  const sorted = [...entries].sort((left, right) => compareBigInt(address(left), address(right)));
  return sorted.flatMap((entry, index) => overlapWithNext(entry, sorted[index + 1]));
}

function overlapWithNext(
  entry: TargetGuestMemoryMaterializationEntry,
  next: TargetGuestMemoryMaterializationEntry | undefined,
): NativeProcessImageRefusal[] {
  return next && endAddress(entry) > address(next)
    ? [
        refusal("mapping-ambiguous", `${entry.mapping} overlaps ${next.mapping}`, {
          left: entry.mapping,
          right: next.mapping,
          targetStart: entry.targetStart,
          nextTargetStart: next.targetStart,
        }),
      ]
    : [];
}

function unsafeMappingRefusal(mapping: NativeMemoryMapping): NativeProcessImageRefusal | undefined {
  if (mapping.permissions.execute) {
    return executableSourceRefusal(mapping);
  }
  if (mapping.permissions.shared) {
    return sharedMappingRefusal(mapping);
  }
  return undefined;
}

function executableSourceRefusal(mapping: NativeMemoryMapping): NativeProcessImageRefusal {
  return refusal(
    "mapping-executable-unsupported",
    `${mapping.id} executable source bytes are not target code`,
    {
      mapping: mapping.id,
      sourceStart: mapping.sourceStart,
      sourceEnd: mapping.sourceEnd,
      sourceTextReusedAsTargetCode: false,
    },
  );
}

function sharedMappingRefusal(mapping: NativeMemoryMapping): NativeProcessImageRefusal {
  return refusal(
    "mapping-shared-unsupported",
    `${mapping.id} shared mapping requires an explicit shared-resource recipe`,
    { mapping: mapping.id, sourceStart: mapping.sourceStart, sourceEnd: mapping.sourceEnd },
  );
}

function isWritableTranslateMapping(mapping: NativeMemoryMapping): boolean {
  return mapping.permissions.write && mapping.target.materialization === "translate";
}

function isGuardMapping(mapping: NativeMemoryMapping): boolean {
  return [
    !mapping.permissions.read,
    !mapping.permissions.write,
    !mapping.permissions.execute,
    mapping.permissions.private,
    mapping.target.materialization === "recreate" || mapping.target.materialization === "refuse",
  ].every(Boolean);
}

function permissionString(mapping: NativeMemoryMapping): string {
  const permissions = mapping.permissions;
  const access = [
    permissions.read ? "r" : "-",
    permissions.write ? "w" : "-",
    permissions.execute ? "x" : "-",
  ];
  const sharing = permissions.shared ? "s" : permissions.private ? "p" : "-";
  return `${access.join("")}${sharing}`;
}

function address(entry: TargetGuestMemoryMaterializationEntry): bigint {
  return BigInt(entry.targetStart);
}

function endAddress(entry: TargetGuestMemoryMaterializationEntry): bigint {
  return address(entry) + BigInt(entry.sizeBytes);
}

function compareBigInt(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function refused(refusal: NativeProcessImageRefusal): { refusals: NativeProcessImageRefusal[] } {
  return { refusals: [refusal] };
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
  detail?: Record<string, unknown>,
): NativeProcessImageRefusal {
  return detail ? { code, message, detail } : { code, message };
}
