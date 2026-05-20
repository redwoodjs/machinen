import { describe, expect, it } from "vitest";

import { buildNativeCodeMap, type NativeCodeMapRequest } from "../native-code-map.ts";

function request(): NativeCodeMapRequest {
  return {
    expectedTargetBuildId: "b16b00b5",
    targetBuildId: "b16b00b5",
    sourceSymbols: [
      {
        name: "native_controlled_resume",
        mapping: "mapping:source-text",
        address: "0x400120",
        sizeBytes: 64,
        metadata: "dwarf",
      },
      {
        name: "native_controlled_helper",
        mapping: "mapping:source-text",
        address: "0x400180",
        sizeBytes: 32,
        metadata: "sidecar",
      },
    ],
    targetSymbols: [
      {
        name: "native_controlled_resume",
        mapping: "mapping:target-text",
        address: "0x14000120",
        sizeBytes: 72,
        metadata: "dwarf",
      },
      {
        name: "native_controlled_helper",
        mapping: "mapping:target-text",
        address: "0x14000190",
        sizeBytes: 40,
        metadata: "sidecar",
      },
    ],
    requestedLocations: [
      { id: "code:resume", symbol: "native_controlled_resume", sourceAddress: "0x400120" },
      { id: "code:helper", symbol: "native_controlled_helper", sourceAddress: "0x400180" },
    ],
  };
}

describe("native code map", () => {
  it("maps source code locations to target code by build identity and symbol metadata", () => {
    const result = buildNativeCodeMap(request());

    expect(result.refusals).toEqual([]);
    expect(result.codeLocations).toEqual([
      {
        id: "code:resume",
        sourceMapping: "mapping:source-text",
        sourceAddress: "0x400120",
        targetAddress: "0x14000120",
        state: "mapped",
      },
      {
        id: "code:helper",
        sourceMapping: "mapping:source-text",
        sourceAddress: "0x400180",
        targetAddress: "0x14000190",
        state: "mapped",
      },
    ]);
  });

  it("refuses target build mismatches before mapping any locations", () => {
    const input = request();
    input.targetBuildId = "deadbeef";

    const result = buildNativeCodeMap(input);

    expect(result.refusals).toEqual([expect.objectContaining({ code: "target-build-mismatch" })]);
    expect(result.codeLocations.every((location) => location.state === "refused")).toBe(true);
  });

  it("refuses unknown target code locations", () => {
    const input = request();
    input.requestedLocations.push({ id: "code:missing", symbol: "native_missing" });

    const result = buildNativeCodeMap(input);

    expect(result.codeLocations.at(-1)).toMatchObject({
      id: "code:missing",
      state: "refused",
      refusal: { code: "code-location-unknown" },
    });
  });

  it("requires DWARF or sidecar size metadata for bare symbol-only mappings", () => {
    const input = request();
    input.sourceSymbols = [
      {
        name: "stripped_resume",
        mapping: "mapping:source-text",
        address: "0x401000",
        metadata: "symbol",
      },
    ];
    input.targetSymbols = [
      {
        name: "stripped_resume",
        mapping: "mapping:target-text",
        address: "0x14001000",
        metadata: "symbol",
      },
    ];
    input.requestedLocations = [{ id: "code:stripped", symbol: "stripped_resume" }];

    const result = buildNativeCodeMap(input);

    expect(result.codeLocations[0]).toMatchObject({
      state: "refused",
      refusal: {
        code: "code-location-unknown",
        message: expect.stringContaining("DWARF or sidecar"),
      },
    });
  });
});
