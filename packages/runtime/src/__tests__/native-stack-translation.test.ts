import { describe, expect, it } from "vitest";

import {
  planNativeStackWindowMaterialization,
  translateNativeStack,
  type NativeStackTranslationRequest,
  type NativeStackWindowMaterializationRequest,
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

function windowRequest(): NativeStackWindowMaterializationRequest {
  return {
    ...request(),
    sourceStackBase: "0x7fff0000",
    sourceStackLimit: "0x80000000",
    targetStackLimit: "0x7fffffffe100",
    guardBelowAddress: "0x7fffffffd000",
    guardAboveAddress: "0x7ffffffff000",
    pointerRanges: [{ id: "heap", targetBase: "0x700000", targetLimit: "0x701000" }],
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

  it("materializes a bounded translated stack window with guard pages", () => {
    const result = planNativeStackWindowMaterialization(windowRequest());

    expect(result.state).toBe("materialized");
    expect(result.refusals).toEqual([]);
    expect(result.targetWindow).toEqual({
      base: "0x7fffffffe000",
      limit: "0x7fffffffe100",
      sizeBytes: 64,
    });
    expect(result.guards).toEqual({ below: "0x7fffffffd000", above: "0x7ffffffff000" });
  });

  it("refuses translated stack windows that do not fit the target range", () => {
    const input = windowRequest();
    input.targetStackLimit = "0x7fffffffe020";

    const result = planNativeStackWindowMaterialization(input);

    expect(result.state).toBe("refused");
    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "target-stack-window-unsupported",
        message: expect.stringContaining("fit"),
      }),
    ]);
  });

  it("refuses guard pages that do not bracket the target window", () => {
    const input = windowRequest();
    input.guardAboveAddress = "0x7fffffffe080";

    const result = planNativeStackWindowMaterialization(input);

    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "target-stack-window-unsupported",
        message: expect.stringContaining("guard"),
      }),
    ]);
  });

  it("refuses pointer slots outside materialized target ranges", () => {
    const input = windowRequest();
    input.frames[0]!.locals[1]!.targetValue = "0x900000";

    const result = planNativeStackWindowMaterialization(input);

    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "pointer-ambiguous",
        message: expect.stringContaining("outside materialized target ranges"),
      }),
    ]);
  });

  it("refuses stack slots that fall outside their validated frame", () => {
    const input = windowRequest();
    input.frames[0]!.locals[1]!.offset = 80;

    const result = planNativeStackWindowMaterialization(input);

    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "target-stack-window-unsupported",
        message: expect.stringContaining("outside the frame"),
      }),
    ]);
  });

  it("refuses malformed stack-window addresses without throwing", () => {
    const input = windowRequest();
    input.targetStackBase = "not-hex";

    const result = planNativeStackWindowMaterialization(input);

    expect(result.state).toBe("refused");
    expect(result.targetWindow.base).toBe("not-hex");
    expect(result.refusals).toContainEqual(
      expect.objectContaining({
        code: "target-stack-window-unsupported",
        message: expect.stringContaining("target stack base"),
      }),
    );
  });
});
