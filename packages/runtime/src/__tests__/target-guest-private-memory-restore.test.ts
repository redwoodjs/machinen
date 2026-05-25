import { describe, expect, it } from "vitest";
import { planTargetGuestPrivateMemoryRestore } from "../target-guest-private-memory-restore.ts";
import type { TargetGuestMemoryMaterializationEntry } from "../target-guest-memory-materialization.ts";

const entries: TargetGuestMemoryMaterializationEntry[] = [
  {
    kind: "copy-captured-bytes",
    mapping: "mapping:heap",
    targetStart: "0x60000000f000",
    sizeBytes: 4096,
    permissions: "rw-p",
    provenance: "native-process-image",
    sourceFile: "native-memory.bin",
    sourceOffset: 0,
  },
  {
    kind: "recreate-guard",
    mapping: "mapping:heap-guard",
    targetStart: "0x60000000e000",
    sizeBytes: 4096,
    permissions: "---p",
    provenance: "guard-protection",
  },
];

describe("target guest private memory restore", () => {
  it("plans mmap/copy/protect steps for private writable memory and guards", () => {
    expect(planTargetGuestPrivateMemoryRestore(entries)).toEqual({
      state: "planned",
      refusals: [],
      steps: [
        {
          action: "mmap-private-writable",
          mapping: "mapping:heap",
          targetStart: "0x60000000f000",
          sizeBytes: 4096,
          permissions: "rw-p",
        },
        {
          action: "copy-captured-bytes",
          mapping: "mapping:heap",
          sourceFile: "native-memory.bin",
          sourceOffset: 0,
          targetStart: "0x60000000f000",
          sizeBytes: 4096,
        },
        {
          action: "mprotect-final",
          mapping: "mapping:heap",
          targetStart: "0x60000000f000",
          sizeBytes: 4096,
          permissions: "rw-p",
        },
        {
          action: "mmap-guard",
          mapping: "mapping:heap-guard",
          targetStart: "0x60000000e000",
          sizeBytes: 4096,
          permissions: "---p",
        },
      ],
    });
  });

  it("refuses executable or shared target memory entries", () => {
    const executable = { ...entries[0]!, permissions: "r-xp" };
    const shared = { ...entries[0]!, permissions: "rw-s" };

    expect(planTargetGuestPrivateMemoryRestore([executable])).toMatchObject({
      state: "refused",
      steps: [],
      refusals: [expect.objectContaining({ code: "mapping-executable-unsupported" })],
    });
    expect(planTargetGuestPrivateMemoryRestore([shared])).toMatchObject({
      state: "refused",
      steps: [],
      refusals: [expect.objectContaining({ code: "mapping-shared-unsupported" })],
    });
  });

  it("refuses copied bytes without writable private permissions", () => {
    const readOnlyCopy = { ...entries[0]!, permissions: "r--p" };

    expect(planTargetGuestPrivateMemoryRestore([readOnlyCopy])).toMatchObject({
      state: "refused",
      steps: [],
      refusals: [
        expect.objectContaining({
          code: "mapping-permission-unsupported",
          message: "mapping:heap copied private memory must be writable",
        }),
      ],
    });
  });

  it("refuses guard entries that would materialize readable or writable bytes", () => {
    const readableGuard = { ...entries[1]!, permissions: "r--p" };

    expect(planTargetGuestPrivateMemoryRestore([readableGuard])).toMatchObject({
      state: "refused",
      steps: [],
      refusals: [
        expect.objectContaining({
          code: "mapping-permission-unsupported",
          message: "mapping:heap-guard guard mapping must be no-access private",
        }),
      ],
    });
  });
});
