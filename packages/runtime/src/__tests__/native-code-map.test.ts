import { describe, expect, it } from "vitest";

import {
  buildNativeCodeMap,
  type NativeCodeMapRequest,
  type NativeCodeModule,
} from "../native-code-map.ts";

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

  it("maps PIE and shared-library locations by module load bias plus relative address", () => {
    const sourceModules: NativeCodeModule[] = [
      {
        id: "module:source-lib",
        logicalName: "libmachinen-pie-proof.so",
        path: "/source/libmachinen-pie-proof.so",
        arch: "arm64",
        kind: "shared-object",
        buildId: "source-lib-build",
        loadBias: "0xffff80000000",
        textMapping: "mapping:source-lib-text",
      },
    ];
    const targetModules: NativeCodeModule[] = [
      {
        id: "module:target-lib",
        logicalName: "libmachinen-pie-proof.so",
        path: "/target/libmachinen-pie-proof.so",
        arch: "amd64",
        kind: "shared-object",
        buildId: "target-lib-build",
        loadBias: "0x7f0000000000",
        textMapping: "mapping:target-lib-text",
      },
    ];
    const result = buildNativeCodeMap({
      expectedTargetBuildId: "target-lib-build",
      targetBuildId: "target-lib-build",
      sourceModules,
      targetModules,
      sourceSymbols: [
        {
          name: "machinen_native_pie_shared_spin",
          mapping: "mapping:source-lib-text",
          moduleId: "module:source-lib",
          address: "0xffff80001120",
          relativeAddress: "0x1120",
          sizeBytes: 64,
          metadata: "dwarf",
        },
      ],
      targetSymbols: [
        {
          name: "machinen_native_pie_shared_spin",
          mapping: "mapping:target-lib-text",
          moduleId: "module:target-lib",
          address: "0x7f00000021a0",
          relativeAddress: "0x21a0",
          sizeBytes: 72,
          buildId: "target-lib-build",
          metadata: "dwarf",
        },
      ],
      requestedLocations: [
        {
          id: "code:shared-spin",
          symbol: "machinen_native_pie_shared_spin",
          sourceAddress: "0xffff80001128",
        },
      ],
    });

    expect(result.refusals).toEqual([]);
    expect(result.codeLocations[0]).toMatchObject({
      id: "code:shared-spin",
      state: "mapped",
      sourceMapping: "mapping:source-lib-text",
      sourceAddress: "0xffff80001128",
      targetAddress: "0x7f00000021a8",
    });
  });

  it("refuses mismatched PIE/shared-library target modules", () => {
    const input = request();
    input.sourceModules = [
      {
        id: "module:source-main",
        logicalName: "machinen-pie-main",
        path: "/source/main",
        arch: "arm64",
        kind: "pie-executable",
        buildId: "source-main-build",
        loadBias: "0x550000000000",
        textMapping: "mapping:source-text",
      },
    ];
    input.targetModules = [
      {
        id: "module:target-main",
        logicalName: "machinen-pie-main",
        path: "/target/main",
        arch: "amd64",
        kind: "pie-executable",
        buildId: "wrong-target-build",
        loadBias: "0x7f1000000000",
        textMapping: "mapping:target-text",
      },
    ];
    input.sourceSymbols = [
      {
        name: "native_controlled_resume",
        mapping: "mapping:source-text",
        moduleId: "module:source-main",
        address: "0x550000001120",
        relativeAddress: "0x1120",
        sizeBytes: 64,
        metadata: "dwarf",
      },
    ];
    input.targetSymbols = [
      {
        name: "native_controlled_resume",
        mapping: "mapping:target-text",
        moduleId: "module:target-main",
        address: "0x7f1000002120",
        relativeAddress: "0x2120",
        sizeBytes: 64,
        buildId: "expected-target-build",
        metadata: "dwarf",
      },
    ];

    const result = buildNativeCodeMap(input);

    expect(result.codeLocations[0]).toMatchObject({
      state: "refused",
      refusal: { code: "target-build-mismatch" },
    });
  });
});
