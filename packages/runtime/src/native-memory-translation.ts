/** Process memory classification and relocation for native cross-ISA restore. */

import type { NativeMemoryRelocation, NativeProcessImageRefusal } from "./native-process-image.ts";

export interface NativeMemoryWord {
  mapping: string;
  offset: number;
  sourceValue: string;
  classification: "integer" | "pointer" | "code-pointer" | "thread-pointer" | "ambiguous";
  targetValue?: string;
  proof: "dwarf" | "sidecar" | "symbol" | "policy" | "none";
}

export interface NativeMemoryTranslationRequest {
  words: NativeMemoryWord[];
}

export interface NativeMemoryTranslationResult {
  relocations: NativeMemoryRelocation[];
  preservedWords: number;
  refusals: NativeProcessImageRefusal[];
}

export function translateNativeMemory(
  request: NativeMemoryTranslationRequest,
): NativeMemoryTranslationResult {
  const results = request.words.map(translateWord);
  return {
    relocations: results.flatMap((result) => result.relocations),
    preservedWords: results.filter((result) => result.preserved).length,
    refusals: results.flatMap((result) => result.refusals),
  };
}

function translateWord(word: NativeMemoryWord): {
  relocations: NativeMemoryRelocation[];
  preserved: boolean;
  refusals: NativeProcessImageRefusal[];
} {
  if (word.classification === "integer") {
    return { relocations: [], preserved: true, refusals: [] };
  }
  if (word.classification === "ambiguous" || word.proof === "none") {
    return {
      relocations: [],
      preserved: false,
      refusals: [
        refusal(
          "pointer-ambiguous",
          `memory word ${word.mapping}+${word.offset} cannot be proven pointer or integer`,
        ),
      ],
    };
  }
  if (!word.targetValue) {
    return {
      relocations: [],
      preserved: false,
      refusals: [
        refusal(
          word.classification === "code-pointer" ? "code-location-unknown" : "pointer-ambiguous",
          `memory word ${word.mapping}+${word.offset} has no target value`,
        ),
      ],
    };
  }
  return {
    relocations: [
      {
        mapping: word.mapping,
        offset: word.offset,
        kind: relocationKind(word.classification),
        sourceValue: word.sourceValue,
        targetValue: word.targetValue,
        state: "translated",
      },
    ],
    preserved: false,
    refusals: [],
  };
}

function relocationKind(
  classification: NativeMemoryWord["classification"],
): NativeMemoryRelocation["kind"] {
  if (classification === "code-pointer") {
    return "code-pointer";
  }
  if (classification === "thread-pointer") {
    return "thread-pointer";
  }
  return "pointer";
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeProcessImageRefusal {
  return { code, message };
}
