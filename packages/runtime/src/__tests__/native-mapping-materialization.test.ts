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
        id: "mapping:vvar",
        kind: "vvar",
        permissions: { read: true, write: false, execute: false, private: true, shared: false },
        target: { materialization: "recreate", targetStart: "0x75001000" },
      }),
      mapping({
        id: "mapping:special",
        kind: "special",
        permissions: { read: true, write: false, execute: false, private: true, shared: false },
        target: { materialization: "recreate", targetStart: "0x75002000" },
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
        expect.objectContaining({ mapping: "mapping:vvar", action: "recreate" }),
        expect.objectContaining({ mapping: "mapping:special", action: "recreate" }),
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
    for (const recreated of ["mapping:vdso", "mapping:vvar", "mapping:special"]) {
      expect(result.steps.find((step) => step.mapping === recreated)?.sourceBytes).toBeUndefined();
    }
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
      refusal: { code: "mapping-captured-range-unsupported" },
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

  it("refuses executable mappings without a target-native file", () => {
    const result = planNativeMappingMaterialization({
      memorySizeBytes: 4096,
      mappings: [
        mapping({
          id: "mapping:source-text-bytes",
          kind: "text",
          permissions: { read: true, write: false, execute: true, private: true, shared: false },
          captured: { file: "native-memory.bin", offset: 0, sizeBytes: 4096 },
          target: { materialization: "translate", targetStart: "0x71000000" },
        }),
      ],
    });

    expect(result.refusals).toEqual([
      expect.objectContaining({ code: "mapping-executable-unsupported" }),
    ]);
    expect(result.steps[0]).toMatchObject({ action: "refuse" });
  });

  it("refuses executable target files without build or hash provenance", () => {
    const result = planNativeMappingMaterialization({
      memorySizeBytes: 0,
      mappings: [
        mapping({
          id: "mapping:unproven-target-text",
          kind: "text",
          permissions: { read: true, write: false, execute: true, private: true, shared: false },
          file: { path: "/target/no-build-id.so", offset: 0 },
          target: { materialization: "translate", targetStart: "0x71000000" },
        }),
      ],
    });

    expect(result.refusals).toEqual([
      expect.objectContaining({ code: "mapping-provenance-ambiguous" }),
    ]);
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

  it("materializes private writable heap, data, and anonymous mappings with guards", () => {
    const result = planNativeMappingMaterialization({
      memorySizeBytes: 12288,
      privateWritableGuards: [
        { mapping: "mapping:heap", belowMapping: "mapping:heap-guard-low" },
        { mapping: "mapping:mmap", aboveMapping: "mapping:mmap-guard-high" },
      ],
      mappings: [
        mapping({
          id: "mapping:heap-guard-low",
          permissions: { read: false, write: false, execute: false, private: true, shared: false },
          target: { materialization: "refuse", reason: "heap guard" },
          refusal: { code: "mapping-unreadable", message: "heap guard" },
        }),
        mapping({
          id: "mapping:heap",
          kind: "heap",
          sourceStart: "0x2000",
          sourceEnd: "0x3000",
          captured: { file: "native-memory.bin", offset: 0, sizeBytes: 4096 },
          target: { materialization: "translate", targetStart: "0x2000" },
        }),
        mapping({
          id: "mapping:data",
          kind: "data",
          captured: { file: "native-memory.bin", offset: 4096, sizeBytes: 4096 },
          target: { materialization: "translate", targetStart: "0x5000" },
        }),
        mapping({
          id: "mapping:mmap",
          kind: "anonymous",
          sourceStart: "0x8000",
          sourceEnd: "0x9000",
          captured: { file: "native-memory.bin", offset: 8192, sizeBytes: 4096 },
          target: { materialization: "translate", targetStart: "0x8000" },
        }),
        mapping({
          id: "mapping:mmap-guard-high",
          sourceStart: "0x9000",
          sourceEnd: "0xa000",
          permissions: { read: false, write: false, execute: false, private: true, shared: false },
          target: { materialization: "refuse", reason: "mmap guard" },
          refusal: { code: "mapping-unreadable", message: "mmap guard" },
        }),
      ],
    });

    expect(result.refusals).toEqual([]);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mapping: "mapping:heap",
          action: "copy-captured-bytes",
          privateWritable: { guardMappings: ["mapping:heap-guard-low"] },
        }),
        expect.objectContaining({ mapping: "mapping:data", action: "copy-captured-bytes" }),
        expect.objectContaining({
          mapping: "mapping:mmap",
          action: "copy-captured-bytes",
          privateWritable: { guardMappings: ["mapping:mmap-guard-high"] },
        }),
        expect.objectContaining({ mapping: "mapping:heap-guard-low", action: "recreate" }),
        expect.objectContaining({ mapping: "mapping:mmap-guard-high", action: "recreate" }),
      ]),
    );
  });

  it("refuses shared writable memory instead of copying it", () => {
    const result = planNativeMappingMaterialization({
      memorySizeBytes: 4096,
      mappings: [
        mapping({
          id: "mapping:shared-writable",
          permissions: { read: true, write: true, execute: false, private: false, shared: true },
          captured: { file: "native-memory.bin", offset: 0, sizeBytes: 4096 },
        }),
      ],
    });

    expect(result.refusals).toEqual([
      expect.objectContaining({ code: "mapping-shared-unsupported" }),
    ]);
  });

  it("refuses private writable mappings with missing or invalid captured bytes precisely", () => {
    const missing = planNativeMappingMaterialization({
      memorySizeBytes: 0,
      mappings: [mapping({ id: "mapping:missing-private-bytes" })],
    });
    const invalid = planNativeMappingMaterialization({
      memorySizeBytes: 1024,
      mappings: [
        mapping({
          id: "mapping:bad-private-bytes",
          captured: { file: "native-memory.bin", offset: 0, sizeBytes: 4096 },
        }),
      ],
    });

    expect(missing.refusals).toEqual([
      expect.objectContaining({ code: "mapping-captured-range-unsupported" }),
    ]);
    expect(invalid.refusals).toEqual([
      expect.objectContaining({ code: "mapping-captured-range-unsupported" }),
    ]);
  });

  it("refuses non-adjacent private writable guards", () => {
    const result = planNativeMappingMaterialization({
      memorySizeBytes: 4096,
      privateWritableGuards: [{ mapping: "mapping:heap", belowMapping: "mapping:guard" }],
      mappings: [
        mapping({
          id: "mapping:guard",
          sourceStart: "0x4000",
          sourceEnd: "0x5000",
          permissions: { read: false, write: false, execute: false, private: true, shared: false },
          target: { materialization: "refuse", reason: "guard" },
          refusal: { code: "mapping-unreadable", message: "guard" },
        }),
        mapping({
          id: "mapping:heap",
          captured: { file: "native-memory.bin", offset: 0, sizeBytes: 4096 },
          target: { materialization: "translate", targetStart: "0x9000" },
        }),
      ],
    });

    expect(result.refusals).toContainEqual(
      expect.objectContaining({
        code: "mapping-ambiguous",
        message: expect.stringContaining("not adjacent"),
      }),
    );
  });
});
