import { describe, expect, it } from "vitest";

import { translateNativeMemory } from "../native-memory-translation.ts";

describe("native memory translation", () => {
  it("preserves integers and relocates metadata-proven pointers", () => {
    const result = translateNativeMemory({
      words: [
        {
          mapping: "mapping:data",
          offset: 0,
          sourceValue: "0x2a",
          classification: "integer",
          proof: "dwarf",
        },
        {
          mapping: "mapping:data",
          offset: 8,
          sourceValue: "0x600000",
          targetValue: "0x700000",
          classification: "pointer",
          proof: "sidecar",
        },
        {
          mapping: "mapping:data",
          offset: 16,
          sourceValue: "0x400180",
          targetValue: "0x14000180",
          classification: "code-pointer",
          proof: "dwarf",
        },
      ],
    });

    expect(result.preservedWords).toBe(1);
    expect(result.refusals).toEqual([]);
    expect(result.relocations).toEqual([
      {
        mapping: "mapping:data",
        offset: 8,
        kind: "pointer",
        sourceValue: "0x600000",
        targetValue: "0x700000",
        state: "translated",
      },
      {
        mapping: "mapping:data",
        offset: 16,
        kind: "code-pointer",
        sourceValue: "0x400180",
        targetValue: "0x14000180",
        state: "translated",
      },
    ]);
  });

  it("refuses ambiguous pointer-like words", () => {
    const result = translateNativeMemory({
      words: [
        {
          mapping: "mapping:heap",
          offset: 24,
          sourceValue: "0x700000",
          classification: "ambiguous",
          proof: "none",
        },
      ],
    });

    expect(result.relocations).toEqual([]);
    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "pointer-ambiguous",
        message: expect.stringContaining("mapping:heap+24"),
      }),
    ]);
  });

  it("refuses missing target values for code pointers", () => {
    const result = translateNativeMemory({
      words: [
        {
          mapping: "mapping:data",
          offset: 32,
          sourceValue: "0x400180",
          classification: "code-pointer",
          proof: "dwarf",
        },
      ],
    });

    expect(result.refusals[0]).toMatchObject({ code: "code-location-unknown" });
  });
});
