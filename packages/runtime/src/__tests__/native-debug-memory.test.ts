import { describe, expect, it } from "vitest";

import { classifyNativeDebugMemoryPointers } from "../native-debug-memory.ts";

const addressTranslations = [
  {
    id: "root",
    sourceStart: "0x1000",
    sourceEnd: "0x2000",
    targetStart: "0x7000",
  },
  {
    id: "heap",
    sourceStart: "0x4000",
    sourceEnd: "0x5000",
    targetStart: "0x9000",
  },
];

describe("native debug memory pointer classification", () => {
  it("classifies DWARF pointer fields and preserves scalar lookalikes", () => {
    const result = classifyNativeDebugMemoryPointers({
      addressTranslations,
      objects: [
        {
          id: "root",
          mapping: "mapping:root",
          sourceStart: "0x1000",
          fields: [
            {
              name: "head",
              offset: 16,
              sizeBytes: 8,
              sourceValue: "0x4040",
              classification: "pointer",
              metadata: "dwarf",
            },
            {
              name: "scalar_lookalike",
              offset: 24,
              sizeBytes: 8,
              sourceValue: "0x4040",
              classification: "integer",
              metadata: "dwarf",
            },
          ],
        },
      ],
    });

    expect(result.refusals).toEqual([]);
    expect(result.preservedWords).toBe(1);
    expect(result.relocatableWords).toBe(1);
    expect(result.words).toEqual([
      {
        mapping: "mapping:root",
        offset: 16,
        sourceValue: "0x4040",
        targetValue: "0x9040",
        classification: "pointer",
        proof: "dwarf",
      },
      {
        mapping: "mapping:root",
        offset: 24,
        sourceValue: "0x4040",
        classification: "integer",
        proof: "dwarf",
      },
    ]);
  });

  it("refuses fields without precise metadata as pointer-ambiguous", () => {
    const result = classifyNativeDebugMemoryPointers({
      addressTranslations,
      objects: [
        {
          id: "root",
          mapping: "mapping:root",
          sourceStart: "0x1000",
          fields: [
            {
              name: "maybe_pointer",
              offset: 8,
              sizeBytes: 8,
              sourceValue: "0x4000",
              classification: "unknown",
              metadata: "none",
            },
          ],
        },
      ],
    });

    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "pointer-ambiguous",
        message: expect.stringContaining("root.maybe_pointer"),
      }),
    ]);
    expect(result.words[0]).toMatchObject({ classification: "ambiguous", proof: "none" });
  });

  it("refuses data pointers that do not map to exactly one target mapping", () => {
    const result = classifyNativeDebugMemoryPointers({
      addressTranslations: [],
      objects: [
        {
          id: "root",
          mapping: "mapping:root",
          sourceStart: "0x1000",
          fields: [
            {
              name: "head",
              offset: 16,
              sizeBytes: 8,
              sourceValue: "0x4040",
              classification: "pointer",
              metadata: "dwarf",
            },
          ],
        },
      ],
    });

    expect(result.refusals[0]).toMatchObject({ code: "mapping-ambiguous" });
  });

  it("refuses unknown code pointer targets", () => {
    const result = classifyNativeDebugMemoryPointers({
      addressTranslations,
      codeLocations: [],
      objects: [
        {
          id: "root",
          mapping: "mapping:root",
          sourceStart: "0x1000",
          fields: [
            {
              name: "callback",
              offset: 32,
              sizeBytes: 8,
              sourceValue: "0x401180",
              classification: "code-pointer",
              metadata: "dwarf",
            },
          ],
        },
      ],
    });

    expect(result.refusals[0]).toMatchObject({ code: "code-location-unknown" });
  });
});
