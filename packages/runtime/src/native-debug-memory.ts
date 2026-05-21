/** Debug-metadata guided native memory pointer classification. */

import type { NativeMemoryWord } from "./native-memory-translation.ts";
import type {
  NativeCodeLocationMapping,
  NativeProcessImageRefusal,
} from "./native-process-image.ts";

export type NativeDebugMemoryMetadataSource = "dwarf" | "symbol" | "none";
export type NativeDebugMemoryFieldClassification =
  | "integer"
  | "pointer"
  | "code-pointer"
  | "unknown";

export interface NativeDebugMemoryField {
  name: string;
  offset: number;
  sizeBytes: number;
  sourceValue: string;
  classification: NativeDebugMemoryFieldClassification;
  metadata: NativeDebugMemoryMetadataSource;
}

export interface NativeDebugMemoryObject {
  id: string;
  mapping: string;
  sourceStart: string;
  mappingOffset?: number;
  fields: NativeDebugMemoryField[];
}

export interface NativeDebugAddressTranslation {
  id: string;
  sourceStart: string;
  sourceEnd: string;
  targetStart: string;
}

export interface NativeDebugMemoryPointerClassificationRequest {
  objects: NativeDebugMemoryObject[];
  addressTranslations: NativeDebugAddressTranslation[];
  codeLocations?: NativeCodeLocationMapping[];
}

export interface NativeDebugMemoryPointerClassificationResult {
  words: NativeMemoryWord[];
  preservedWords: number;
  relocatableWords: number;
  refusals: NativeProcessImageRefusal[];
}

interface WordResult {
  word: NativeMemoryWord;
  refusal?: NativeProcessImageRefusal;
}

export function classifyNativeDebugMemoryPointers(
  request: NativeDebugMemoryPointerClassificationRequest,
): NativeDebugMemoryPointerClassificationResult {
  const results = request.objects.flatMap((object) =>
    object.fields.map((field) => classifyField(request, object, field)),
  );
  const words = results.map((result) => result.word);
  return {
    words,
    preservedWords: words.filter((word) => word.classification === "integer").length,
    relocatableWords: words.filter(
      (word) => word.classification === "pointer" || word.classification === "code-pointer",
    ).length,
    refusals: results.flatMap((result) => (result.refusal ? [result.refusal] : [])),
  };
}

function classifyField(
  request: NativeDebugMemoryPointerClassificationRequest,
  object: NativeDebugMemoryObject,
  field: NativeDebugMemoryField,
): WordResult {
  const base = wordBase(object, field);
  if (field.metadata === "none" || field.classification === "unknown") {
    return refusedWord(base, pointerAmbiguous(object, field));
  }
  if (field.classification === "integer") {
    return { word: { ...base, classification: "integer" } };
  }
  if (field.classification === "code-pointer") {
    const resolved = resolveCodePointer(field.sourceValue, request.codeLocations ?? []);
    return "refusal" in resolved
      ? refusedWord({ ...base, classification: "code-pointer" }, resolved.refusal)
      : { word: { ...base, classification: "code-pointer", targetValue: resolved.targetValue } };
  }
  const resolved = resolveDataPointer(field.sourceValue, request.addressTranslations);
  return "refusal" in resolved
    ? refusedWord({ ...base, classification: "pointer" }, resolved.refusal)
    : { word: { ...base, classification: "pointer", targetValue: resolved.targetValue } };
}

function wordBase(
  object: NativeDebugMemoryObject,
  field: NativeDebugMemoryField,
): Omit<NativeMemoryWord, "classification"> {
  return {
    mapping: object.mapping,
    offset: (object.mappingOffset ?? 0) + field.offset,
    sourceValue: field.sourceValue,
    proof: field.metadata,
  };
}

function refusedWord(
  base: Omit<NativeMemoryWord, "classification"> & {
    classification?: NativeMemoryWord["classification"];
  },
  refusal: NativeProcessImageRefusal,
): WordResult {
  return {
    word: { ...base, classification: base.classification ?? "ambiguous" },
    refusal,
  };
}

function resolveDataPointer(
  sourceValue: string,
  translations: NativeDebugAddressTranslation[],
): { targetValue: string; refusal?: undefined } | { refusal: NativeProcessImageRefusal } {
  const value = BigInt(sourceValue);
  if (value === 0n) {
    return { targetValue: "0x0" };
  }
  const matches = translations.filter(
    (translation) =>
      value >= BigInt(translation.sourceStart) && value < BigInt(translation.sourceEnd),
  );
  if (matches.length !== 1) {
    return {
      refusal: {
        code: "mapping-ambiguous",
        message: `data pointer ${sourceValue} matched ${matches.length} target mappings`,
        detail: { sourceValue, matches: matches.map((match) => match.id) },
      },
    };
  }
  const match = matches[0];
  return { targetValue: hex(BigInt(match.targetStart) + (value - BigInt(match.sourceStart))) };
}

function resolveCodePointer(
  sourceValue: string,
  codeLocations: NativeCodeLocationMapping[],
): { targetValue: string; refusal?: undefined } | { refusal: NativeProcessImageRefusal } {
  const value = BigInt(sourceValue);
  if (value === 0n) {
    return { targetValue: "0x0" };
  }
  const location = codeLocations.find(
    (candidate) => candidate.state === "mapped" && BigInt(candidate.sourceAddress) === value,
  );
  if (!location?.targetAddress) {
    return {
      refusal: {
        code: "code-location-unknown",
        message: `code pointer ${sourceValue} did not resolve to a target code location`,
        detail: { sourceValue },
      },
    };
  }
  return { targetValue: location.targetAddress };
}

function pointerAmbiguous(
  object: NativeDebugMemoryObject,
  field: NativeDebugMemoryField,
): NativeProcessImageRefusal {
  return {
    code: "pointer-ambiguous",
    message: `field ${object.id}.${field.name} has no precise pointer classification metadata`,
    detail: {
      object: object.id,
      field: field.name,
      offset: field.offset,
      metadata: field.metadata,
      classification: field.classification,
    },
  };
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
