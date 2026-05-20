/** Stack-frame and continuation translation for native process images. */

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

export function translateNativeStack(
  request: NativeStackTranslationRequest,
): NativeStackTranslationResult {
  const codeLocations = mappedCodeLocations(request.codeLocations);
  const frameResults = request.frames.map((frame) => translateFrame(request, frame, codeLocations));
  const refusals = frameResults.flatMap((result) => result.refusals);
  return {
    stackMapping: request.stackMapping,
    targetStackBase: request.targetStackBase,
    targetStackSizeBytes: request.frames.reduce((total, frame) => total + frame.sizeBytes, 0),
    relocations: frameResults.flatMap((result) => result.relocations),
    refusals,
  };
}

function mappedCodeLocations(codeLocations: NativeCodeLocationMapping[]): Map<string, string> {
  const mapped = new Map<string, string>();
  for (const location of codeLocations) {
    if (location.state === "mapped" && location.targetAddress) {
      mapped.set(normalizeHex(location.sourceAddress), location.targetAddress);
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
  const returnAddress = codeLocations.get(normalizeHex(frame.sourceReturnAddress));
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

function normalizeHex(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}
