import { describe, expect, it } from "vitest";
import type { NativeMemoryMapping } from "../native-process-image.ts";
import { planTargetGuestMemoryMaterialization } from "../target-guest-memory-materialization.ts";

function mapping(overrides: Partial<NativeMemoryMapping> = {}): NativeMemoryMapping {
  return {
    id: "heap",
    kind: "heap",
    sourceStart: "0x400000000000",
    sourceEnd: "0x400000001000",
    sizeBytes: 4096,
    permissions: { read: true, write: true, execute: false, private: true, shared: false },
    captured: { file: "native-memory.bin", offset: 0, sizeBytes: 4096 },
    target: { materialization: "translate", targetStart: "0x600000000000" },
    ...overrides,
  };
}

describe("target guest memory materialization", () => {
  it("materializes safe writable mappings with captured-byte provenance", () => {
    const result = planTargetGuestMemoryMaterialization({
      mappings: [mapping()],
      memoryFile: "/tmp/native-memory.bin",
      memorySizeBytes: 4096,
    });

    expect(result.refusals).toEqual([]);
    expect(result.entries).toEqual([
      {
        kind: "copy-captured-bytes",
        mapping: "heap",
        targetStart: "0x600000000000",
        sizeBytes: 4096,
        permissions: "rw-p",
        sourceFile: "/tmp/native-memory.bin",
        sourceOffset: 0,
        provenance: "native-process-image",
      },
    ]);
  });

  it("represents guard mappings without captured bytes", () => {
    const result = planTargetGuestMemoryMaterialization({
      mappings: [
        mapping({
          id: "guard",
          kind: "stack",
          permissions: { read: false, write: false, execute: false, private: true, shared: false },
          captured: undefined,
          target: { materialization: "recreate", targetStart: "0x600000010000" },
        }),
      ],
      memoryFile: "/tmp/native-memory.bin",
      memorySizeBytes: 0,
    });

    expect(result.refusals).toEqual([]);
    expect(result.entries).toEqual([
      {
        kind: "recreate-guard",
        mapping: "guard",
        targetStart: "0x600000010000",
        sizeBytes: 4096,
        permissions: "---p",
        provenance: "guard-protection",
      },
    ]);
  });

  it("refuses executable source mappings instead of reusing source text", () => {
    const result = planTargetGuestMemoryMaterialization({
      mappings: [
        mapping({
          id: "text",
          kind: "text",
          permissions: { read: true, write: false, execute: true, private: true, shared: false },
        }),
      ],
      memoryFile: "/tmp/native-memory.bin",
      memorySizeBytes: 4096,
    });

    expect(result.entries).toEqual([]);
    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "mapping-executable-unsupported",
        detail: expect.objectContaining({ sourceTextReusedAsTargetCode: false }),
      }),
    ]);
  });

  it("refuses source vDSO/vvar pages instead of copying target-owned kernel mappings", () => {
    const result = planTargetGuestMemoryMaterialization({
      mappings: [
        mapping({
          id: "vdso-source",
          kind: "vdso",
          permissions: { read: true, write: false, execute: true, private: true, shared: false },
          captured: { file: "native-memory.bin", offset: 0, sizeBytes: 4096 },
          target: { materialization: "translate", targetStart: "0x600000010000" },
        }),
        mapping({
          id: "vvar-source",
          kind: "vvar",
          permissions: { read: true, write: true, execute: false, private: true, shared: false },
          captured: { file: "native-memory.bin", offset: 4096, sizeBytes: 4096 },
          target: { materialization: "translate", targetStart: "0x600000011000" },
        }),
      ],
      memoryFile: "/tmp/native-memory.bin",
      memorySizeBytes: 8192,
    });

    expect(result.entries).toEqual([]);
    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "vdso-policy-unsupported",
        detail: expect.objectContaining({
          mapping: "vdso-source",
          sourceBytesCopied: false,
          targetOwned: true,
        }),
      }),
      expect.objectContaining({
        code: "vdso-policy-unsupported",
        detail: expect.objectContaining({ mapping: "vvar-source", sourceBytesCopied: false }),
      }),
    ]);
  });

  it("refuses shared mappings without an explicit shared-resource recipe", () => {
    const result = planTargetGuestMemoryMaterialization({
      mappings: [
        mapping({
          permissions: { read: true, write: true, execute: false, private: false, shared: true },
        }),
      ],
      memoryFile: "/tmp/native-memory.bin",
      memorySizeBytes: 4096,
    });

    expect(result.entries).toEqual([]);
    expect(result.refusals).toEqual([
      expect.objectContaining({ code: "mapping-shared-unsupported" }),
    ]);
  });

  it("refuses ambiguous captured-byte provenance", () => {
    const result = planTargetGuestMemoryMaterialization({
      mappings: [
        mapping({
          captured: {
            file: "other-memory.bin",
            offset: 0,
            sizeBytes: 4096,
          } as unknown as NativeMemoryMapping["captured"],
        }),
      ],
      memoryFile: "/tmp/native-memory.bin",
      memorySizeBytes: 4096,
    });

    expect(result.entries).toEqual([]);
    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "mapping-provenance-ambiguous",
        message: expect.stringContaining("native-memory.bin"),
      }),
    ]);
  });

  it("refuses captured byte underlaps", () => {
    const result = planTargetGuestMemoryMaterialization({
      mappings: [mapping({ captured: { file: "native-memory.bin", offset: 0, sizeBytes: 1024 } })],
      memoryFile: "/tmp/native-memory.bin",
      memorySizeBytes: 4096,
    });

    expect(result.entries).toEqual([]);
    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "mapping-captured-range-unsupported",
        message: expect.stringContaining("exactly cover"),
      }),
    ]);
  });

  it("refuses overlapping target materialization ranges", () => {
    const result = planTargetGuestMemoryMaterialization({
      mappings: [
        mapping({
          id: "heap-a",
          target: { materialization: "translate", targetStart: "0x600000000000" },
        }),
        mapping({
          id: "heap-b",
          captured: { file: "native-memory.bin", offset: 4096, sizeBytes: 4096 },
          target: { materialization: "translate", targetStart: "0x600000000800" },
        }),
      ],
      memoryFile: "/tmp/native-memory.bin",
      memorySizeBytes: 8192,
    });

    expect(result.entries).toHaveLength(2);
    expect(result.refusals).toEqual([
      expect.objectContaining({ code: "mapping-ambiguous", message: "heap-a overlaps heap-b" }),
    ]);
  });
});
