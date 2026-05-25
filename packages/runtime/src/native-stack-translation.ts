/** Stack-frame and continuation translation for native process images. */

import { normalizeNativeHex } from "./native-hex.ts";
import type {
  NativeCodeLocationMapping,
  NativeMemoryRelocation,
  NativeProcessImageRefusal,
} from "./native-process-image.ts";

export interface NativeStackFrame {
  id: string;
  sourceSp: string;
  sourceReturnAddress: string;
  sizeBytes: number;
  metadata: "dwarf" | "sidecar" | "unknown";
  locals: NativeStackSlot[];
}

export interface NativeStackSlot {
  offset: number;
  kind: "integer" | "pointer" | "code-pointer" | "ambiguous";
  sourceValue: string;
  targetValue?: string;
}

export interface NativeStackTranslationRequest {
  stackMapping: string;
  targetStackBase: string;
  frames: NativeStackFrame[];
  codeLocations: NativeCodeLocationMapping[];
}

export interface NativeStackTranslationResult {
  stackMapping: string;
  targetStackBase: string;
  targetStackSizeBytes: number;
  relocations: NativeMemoryRelocation[];
  refusals: NativeProcessImageRefusal[];
}

export interface NativeStackPointerRange {
  id: string;
  targetBase: string;
  targetLimit: string;
}

export interface NativeStackWindowMaterializationRequest extends NativeStackTranslationRequest {
  sourceStackBase: string;
  sourceStackLimit: string;
  targetStackLimit: string;
  guardBelowAddress: string;
  guardAboveAddress: string;
  pointerRanges: NativeStackPointerRange[];
}

export interface NativeStackWindowMaterializationPlan {
  state: "materialized" | "refused";
  stackMapping: string;
  sourceWindow: { base: string; limit: string };
  targetWindow: { base: string; limit: string; sizeBytes: number };
  guards: { below: string; above: string };
  relocations: NativeMemoryRelocation[];
  refusals: NativeProcessImageRefusal[];
}

export function translateNativeStack(
  request: NativeStackTranslationRequest,
): NativeStackTranslationResult {
  const codeLocations = mappedCodeLocations(request.codeLocations);
  const frameResults = request.frames.map((frame) => translateFrame(request, frame, codeLocations));
  const refusals = frameResults.flatMap((result) => result.refusals);
  return {
    stackMapping: request.stackMapping,
    targetStackBase: request.targetStackBase,
    targetStackSizeBytes: stackWindowSize(request.frames),
    relocations: frameResults.flatMap((result) => result.relocations),
    refusals,
  };
}

export function planNativeStackWindowMaterialization(
  request: NativeStackWindowMaterializationRequest,
): NativeStackWindowMaterializationPlan {
  const translation = translateNativeStack(request);
  const windowRefusals = validateStackWindow(request);
  const pointerRefusals = validatePointerSlots(request);
  const refusals = [...translation.refusals, ...windowRefusals, ...pointerRefusals];
  return {
    state: refusals.length === 0 ? "materialized" : "refused",
    stackMapping: request.stackMapping,
    sourceWindow: {
      base: normalizeAddressOrOriginal(request.sourceStackBase),
      limit: normalizeAddressOrOriginal(request.sourceStackLimit),
    },
    targetWindow: {
      base: normalizeAddressOrOriginal(request.targetStackBase),
      limit: normalizeAddressOrOriginal(request.targetStackLimit),
      sizeBytes: translation.targetStackSizeBytes,
    },
    guards: {
      below: normalizeAddressOrOriginal(request.guardBelowAddress),
      above: normalizeAddressOrOriginal(request.guardAboveAddress),
    },
    relocations: translation.relocations,
    refusals,
  };
}

function validateStackWindow(
  request: NativeStackWindowMaterializationRequest,
): NativeProcessImageRefusal[] {
  const refusals: NativeProcessImageRefusal[] = [];
  const parsed = parseStackWindowAddresses(request);
  if (parsed.refusals.length > 0) {
    return parsed.refusals;
  }
  const { sourceBase, sourceLimit, targetBase, targetLimit, guardBelow, guardAbove } = parsed;
  const targetSize = BigInt(stackWindowSize(request.frames));

  if (sourceBase >= sourceLimit) {
    refusals.push(stackWindowRefusal("source stack base must be below source stack limit"));
  }
  if (targetBase >= targetLimit) {
    refusals.push(stackWindowRefusal("target stack base must be below target stack limit"));
  }
  if (targetSize === 0n || targetBase + targetSize > targetLimit) {
    refusals.push(stackWindowRefusal("translated stack frames do not fit in the target window"));
  }
  if (guardBelow >= targetBase || guardAbove <= targetLimit) {
    refusals.push(stackWindowRefusal("guard pages must bracket the target stack window"));
  }

  for (const frame of request.frames) {
    refusals.push(...validateFrameWindow(frame, sourceBase, sourceLimit));
  }
  return refusals;
}

function validateFrameWindow(
  frame: NativeStackFrame,
  sourceBase: bigint,
  sourceLimit: bigint,
): NativeProcessImageRefusal[] {
  return [
    ...validateFrameSize(frame),
    ...validateFrameSourceSp(frame, sourceBase, sourceLimit),
    ...validateFrameSlots(frame),
  ];
}

function validateFrameSize(frame: NativeStackFrame): NativeProcessImageRefusal[] {
  return frame.sizeBytes <= 0 || !Number.isSafeInteger(frame.sizeBytes)
    ? [stackWindowRefusal(`stack frame ${frame.id} has invalid size`)]
    : [];
}

function validateFrameSourceSp(
  frame: NativeStackFrame,
  sourceBase: bigint,
  sourceLimit: bigint,
): NativeProcessImageRefusal[] {
  const sourceSp = parseAddress(frame.sourceSp, `stack frame ${frame.id} source SP`);
  if ("refusal" in sourceSp) {
    return [sourceSp.refusal];
  }
  return sourceSp.value < sourceBase || sourceSp.value >= sourceLimit
    ? [stackWindowRefusal(`stack frame ${frame.id} source SP is outside the source stack`)]
    : [];
}

function validateFrameSlots(frame: NativeStackFrame): NativeProcessImageRefusal[] {
  return frame.locals
    .filter((slot) => slot.offset < 0 || slot.offset + 8 > frame.sizeBytes)
    .map((slot) =>
      stackWindowRefusal(`stack frame ${frame.id} slot ${slot.offset} is outside the frame`),
    );
}

function validatePointerSlots(
  request: NativeStackWindowMaterializationRequest,
): NativeProcessImageRefusal[] {
  const ranges = [
    ...request.pointerRanges,
    {
      id: `${request.stackMapping}:target-window`,
      targetBase: request.targetStackBase,
      targetLimit: request.targetStackLimit,
    },
  ];
  const refusals: NativeProcessImageRefusal[] = [];
  for (const frame of request.frames) {
    for (const slot of frame.locals) {
      if (slot.kind === "pointer" && slot.targetValue && !valueInRanges(slot.targetValue, ranges)) {
        refusals.push(
          refusal(
            "pointer-ambiguous",
            `stack frame ${frame.id} slot ${slot.offset} target pointer is outside materialized target ranges`,
          ),
        );
      }
    }
  }
  return refusals;
}

function valueInRanges(value: string, ranges: NativeStackPointerRange[]): boolean {
  const target = parseAddress(value, "target pointer");
  if ("refusal" in target) {
    return false;
  }
  return ranges.some((range) => {
    const base = parseAddress(range.targetBase, `pointer range ${range.id} base`);
    const limit = parseAddress(range.targetLimit, `pointer range ${range.id} limit`);
    if ("refusal" in base || "refusal" in limit) {
      return false;
    }
    return target.value >= base.value && target.value < limit.value;
  });
}

function parseStackWindowAddresses(request: NativeStackWindowMaterializationRequest): {
  refusals: NativeProcessImageRefusal[];
  sourceBase: bigint;
  sourceLimit: bigint;
  targetBase: bigint;
  targetLimit: bigint;
  guardBelow: bigint;
  guardAbove: bigint;
} {
  const fields = {
    sourceBase: parseAddress(request.sourceStackBase, "source stack base"),
    sourceLimit: parseAddress(request.sourceStackLimit, "source stack limit"),
    targetBase: parseAddress(request.targetStackBase, "target stack base"),
    targetLimit: parseAddress(request.targetStackLimit, "target stack limit"),
    guardBelow: parseAddress(request.guardBelowAddress, "guard below address"),
    guardAbove: parseAddress(request.guardAboveAddress, "guard above address"),
  };
  const refusals = Object.values(fields).flatMap((field) =>
    "refusal" in field ? [field.refusal] : [],
  );
  return {
    refusals,
    sourceBase: "refusal" in fields.sourceBase ? 0n : fields.sourceBase.value,
    sourceLimit: "refusal" in fields.sourceLimit ? 0n : fields.sourceLimit.value,
    targetBase: "refusal" in fields.targetBase ? 0n : fields.targetBase.value,
    targetLimit: "refusal" in fields.targetLimit ? 0n : fields.targetLimit.value,
    guardBelow: "refusal" in fields.guardBelow ? 0n : fields.guardBelow.value,
    guardAbove: "refusal" in fields.guardAbove ? 0n : fields.guardAbove.value,
  };
}

function parseAddress(
  value: string,
  field: string,
): { value: bigint } | { refusal: NativeProcessImageRefusal } {
  try {
    return { value: BigInt(value) };
  } catch {
    return { refusal: stackWindowRefusal(`${field} is not a valid address`) };
  }
}

function normalizeAddressOrOriginal(value: string): string {
  try {
    return normalizeNativeHex(value);
  } catch {
    return value;
  }
}

function stackWindowSize(frames: NativeStackFrame[]): number {
  return frames.reduce((total, frame) => total + frame.sizeBytes, 0);
}

function stackWindowRefusal(message: string): NativeProcessImageRefusal {
  return refusal("target-stack-window-unsupported", message);
}

function mappedCodeLocations(codeLocations: NativeCodeLocationMapping[]): Map<string, string> {
  const mapped = new Map<string, string>();
  for (const location of codeLocations) {
    if (location.state === "mapped" && location.targetAddress) {
      mapped.set(normalizeNativeHex(location.sourceAddress), location.targetAddress);
    }
  }
  return mapped;
}

function translateFrame(
  request: NativeStackTranslationRequest,
  frame: NativeStackFrame,
  codeLocations: Map<string, string>,
): { relocations: NativeMemoryRelocation[]; refusals: NativeProcessImageRefusal[] } {
  if (frame.metadata === "unknown") {
    return {
      relocations: [],
      refusals: [
        refusal(
          "mapping-ambiguous",
          `stack frame ${frame.id} has no unwind/DWARF/sidecar metadata`,
        ),
      ],
    };
  }
  const returnAddress = codeLocations.get(normalizeNativeHex(frame.sourceReturnAddress));
  if (!returnAddress) {
    return {
      relocations: [],
      refusals: [
        refusal(
          "code-location-unknown",
          `stack frame ${frame.id} return address ${frame.sourceReturnAddress} has no target code location`,
        ),
      ],
    };
  }

  const localResults = frame.locals.map((slot) => translateSlot(request, frame, slot));
  return {
    relocations: [
      {
        mapping: request.stackMapping,
        offset: frameOffset(request.frames, frame),
        kind: "return-address",
        sourceValue: frame.sourceReturnAddress,
        targetValue: returnAddress,
        state: "translated",
      },
      ...localResults.flatMap((result) => result.relocations),
    ],
    refusals: localResults.flatMap((result) => result.refusals),
  };
}

function translateSlot(
  request: NativeStackTranslationRequest,
  frame: NativeStackFrame,
  slot: NativeStackSlot,
): { relocations: NativeMemoryRelocation[]; refusals: NativeProcessImageRefusal[] } {
  if (slot.kind === "integer") {
    return { relocations: [], refusals: [] };
  }
  if (slot.kind === "ambiguous") {
    return {
      relocations: [],
      refusals: [
        refusal("pointer-ambiguous", `stack frame ${frame.id} slot ${slot.offset} is ambiguous`),
      ],
    };
  }
  if (!slot.targetValue) {
    return {
      relocations: [],
      refusals: [
        refusal(
          slot.kind === "code-pointer" ? "code-location-unknown" : "pointer-ambiguous",
          `stack frame ${frame.id} slot ${slot.offset} has no target value`,
        ),
      ],
    };
  }
  return {
    relocations: [
      {
        mapping: request.stackMapping,
        offset: frameOffset(request.frames, frame) + slot.offset,
        kind: slot.kind,
        sourceValue: slot.sourceValue,
        targetValue: slot.targetValue,
        state: "translated",
      },
    ],
    refusals: [],
  };
}

function frameOffset(frames: NativeStackFrame[], frame: NativeStackFrame): number {
  let offset = 0;
  for (const candidate of frames) {
    if (candidate === frame) {
      return offset;
    }
    offset += candidate.sizeBytes;
  }
  return offset;
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeProcessImageRefusal {
  return { code, message };
}
