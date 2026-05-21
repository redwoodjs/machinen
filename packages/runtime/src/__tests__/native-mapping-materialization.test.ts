import { describe, expect, it } from "vitest";

import {
  planNativeMappingMaterialization,
  type NativeMappingMaterializationRequest,
} from "../native-mapping-materialization.ts";
import type { NativeMemoryMapping } from "../native-process-image.ts";

function mapping(overrides: Partial<NativeMemoryMapping>): NativeMemoryMapping {
  return {
    id: "mapping:test",
    kind: "anonymous",
    sourceStart: "0x1000",
    sourceEnd: "0x2000",
    sizeBytes: 4096,
    permissions: { read: true, write: true, execute: false, private: true, shared: false },
    target: { materialization: "translate", targetStart: "0x70000000" },
    ...overrides,
  };
}

function request(): NativeMappingMaterializationRequest {
  const textFile = {
    path: "/target/libproof.so",
    offset: 0,
    buildId: "target-build",
    sha256: "target-build",
  };
  return {
    memorySizeBytes: 8192,
    targetFileBuildIds: { [textFile.path]: "target-build" },
    mappings: [
      mapping({
        id: "mapping:text",
        kind: "text",
        permissions: { read: true, write: false, execute: true, private: true, shared: false },
        file: textFile,
        target: { materialization: "translate", targetStart: "0x71000000" },
      }),
      mapping({
        id: "mapping:data",
        kind: "data",
        captured: { file: "native-memory.bin", offset: 0, sizeBytes: 4096 },
        target: { materialization: "translate", targetStart: "0x72000000" },
      }),
      mapping({
        id: "mapping:heap",
        kind: "heap",
        captured: { file: "native-memory.bin", offset: 4096, sizeBytes: 4096 },
        target: { materialization: "translate", targetStart: "0x73000000" },
      }),
      mapping({
        id: "mapping:stack",
        kind: "stack",
        target: { materialization: "recreate", targetStart: "0x74000000" },
      }),
      mapping({
        id: "mapping:vdso",
        kind: "vdso",
        permissions: { read: true, write: false, execute: true, private: true, shared: false },
        target: { materialization: "recreate", targetStart: "0x75000000" },
      }),
      mapping({
        id: "mapping:guard",
        permissions: { read: false, write: false, execute: false, private: true, shared: false },
        target: { materialization: "refuse", reason: "guard page was unreadable at capture" },
        refusal: { code: "mapping-unreadable", message: "guard mapping has no bytes" },
      }),
      mapping({
        id: "mapping:file-protection",
        kind: "file",
        permissions: { read: false, write: false, execute: false, private: true, shared: false },
        file: { path: "/target/protected-gap.dat", offset: 0 },
        target: { materialization: "refuse", reason: "file-backed protection mapping" },
        refusal: { code: "mapping-unreadable", message: "file gap has no current access" },
      }),
      mapping({
        id: "mapping:unreadable-shared",
        permissions: { read: false, write: false, execute: false, private: false, shared: true },
        target: { materialization: "refuse", reason: "shared unreadable mapping" },
        refusal: { code: "mapping-unreadable", message: "mapping is unreadable" },
      }),
    ],
  };
}

describe("native mapping materialization", () => {
  it("plans target file, captured byte, recreated, guard, and refused mappings", () => {
    const result = planNativeMappingMaterialization(request());

    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "mapping-unreadable",
        detail: expect.objectContaining({
          mapping: "mapping:unreadable-shared",
          perms: "---s",
          path: "",
        }),
      }),
    ]);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mapping: "mapping:text", action: "map-target-file" }),
        expect.objectContaining({ mapping: "mapping:data", action: "copy-captured-bytes" }),
        expect.objectContaining({ mapping: "mapping:heap", action: "copy-captured-bytes" }),
        expect.objectContaining({ mapping: "mapping:stack", action: "recreate" }),
        expect.objectContaining({ mapping: "mapping:vdso", action: "recreate" }),
        expect.objectContaining({
          mapping: "mapping:guard",
          action: "recreate",
          targetStart: "0x1000",
        }),
        expect.objectContaining({
          mapping: "mapping:file-protection",
          action: "recreate",
          targetStart: "0x1000",
        }),
        expect.objectContaining({ mapping: "mapping:unreadable-shared", action: "refuse" }),
      ]),
    );
    expect(
      result.steps.find((step) => step.mapping === "mapping:text")?.sourceBytes,
    ).toBeUndefined();
    expect(result.steps.find((step) => step.mapping === "mapping:data")?.sourceBytes).toEqual({
      offset: 0,
      sizeBytes: 4096,
    });
  });

  it("refuses invalid captured byte ranges precisely", () => {
    const result = planNativeMappingMaterialization({
      memorySizeBytes: 1024,
      mappings: [
        mapping({
          id: "mapping:bad-bytes",
          captured: { file: "native-memory.bin", offset: 0, sizeBytes: 4096 },
        }),
      ],
    });

    expect(result.steps[0]).toMatchObject({
      action: "refuse",
      refusal: { code: "mapping-ambiguous" },
    });
  });

  it("refuses target file build mismatches precisely", () => {
    const result = planNativeMappingMaterialization({
      memorySizeBytes: 0,
      targetFileBuildIds: { "/target/libproof.so": "actual-build" },
      mappings: [
        mapping({
          id: "mapping:text",
          kind: "text",
          permissions: { read: true, write: false, execute: true, private: true, shared: false },
          file: { path: "/target/libproof.so", offset: 0, buildId: "expected-build" },
          target: { materialization: "translate", targetStart: "0x71000000" },
        }),
      ],
    });

    expect(result.refusals).toEqual([expect.objectContaining({ code: "target-build-mismatch" })]);
  });

  it("refuses writable executable mappings", () => {
    const result = planNativeMappingMaterialization({
      memorySizeBytes: 0,
      mappings: [
        mapping({
          id: "mapping:w-and-x",
          permissions: { read: true, write: true, execute: true, private: true, shared: false },
        }),
      ],
    });

    expect(result.refusals).toEqual([
      expect.objectContaining({ code: "mapping-permission-unsupported" }),
    ]);
  });
});
