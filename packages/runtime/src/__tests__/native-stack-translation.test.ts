import { describe, expect, it } from "vitest";

import {
  translateNativeStack,
  type NativeStackTranslationRequest,
} from "../native-stack-translation.ts";

function request(): NativeStackTranslationRequest {
  return {
    stackMapping: "mapping:stack",
    targetStackBase: "0x7fffffffe000",
    codeLocations: [
      {
        id: "code:return",
        sourceMapping: "mapping:text",
        sourceAddress: "0x400180",
        targetAddress: "0x14000180",
        state: "mapped",
      },
    ],
    frames: [
      {
        id: "frame:main",
        sourceSp: "0x7fff0000",
        sourceReturnAddress: "0x400180",
        sizeBytes: 64,
        metadata: "dwarf",
        locals: [
          { offset: 16, kind: "integer", sourceValue: "0x2a" },
          { offset: 24, kind: "pointer", sourceValue: "0x600000", targetValue: "0x700000" },
          { offset: 32, kind: "code-pointer", sourceValue: "0x400180", targetValue: "0x14000180" },
        ],
      },
    ],
  };
}

describe("native stack translation", () => {
  it("translates return addresses and metadata-proven stack pointer slots", () => {
    const result = translateNativeStack(request());

    expect(result.refusals).toEqual([]);
    expect(result.targetStackSizeBytes).toBe(64);
    expect(result.relocations).toEqual([
      {
        mapping: "mapping:stack",
        offset: 0,
        kind: "return-address",
        sourceValue: "0x400180",
        targetValue: "0x14000180",
        state: "translated",
      },
      {
        mapping: "mapping:stack",
        offset: 24,
        kind: "pointer",
        sourceValue: "0x600000",
        targetValue: "0x700000",
        state: "translated",
      },
      {
        mapping: "mapping:stack",
        offset: 32,
        kind: "code-pointer",
        sourceValue: "0x400180",
        targetValue: "0x14000180",
        state: "translated",
      },
    ]);
  });

  it("refuses frames without unwind metadata", () => {
    const input = request();
    input.frames[0]!.metadata = "unknown";

    const result = translateNativeStack(input);

    expect(result.relocations).toEqual([]);
    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "mapping-ambiguous",
        message: expect.stringContaining("metadata"),
      }),
    ]);
  });

  it("refuses unknown return addresses", () => {
    const input = request();
    input.frames[0]!.sourceReturnAddress = "0x499999";

    const result = translateNativeStack(input);

    expect(result.relocations).toEqual([]);
    expect(result.refusals[0]).toMatchObject({ code: "code-location-unknown" });
  });

  it("refuses ambiguous pointer-like stack slots", () => {
    const input = request();
    input.frames[0]!.locals.push({ offset: 40, kind: "ambiguous", sourceValue: "0x700000" });

    const result = translateNativeStack(input);

    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "pointer-ambiguous",
        message: expect.stringContaining("slot 40"),
      }),
    ]);
  });
});
