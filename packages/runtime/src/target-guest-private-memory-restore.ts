import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type { TargetGuestMemoryMaterializationEntry } from "./target-guest-memory-materialization.ts";

export type TargetGuestPrivateMemoryRestoreStep =
  | {
      action: "mmap-private-writable";
      mapping: string;
      targetStart: string;
      sizeBytes: number;
      permissions: string;
    }
  | {
      action: "copy-captured-bytes";
      mapping: string;
      sourceFile: string;
      sourceOffset: number;
      targetStart: string;
      sizeBytes: number;
    }
  | {
      action: "mprotect-final";
      mapping: string;
      targetStart: string;
      sizeBytes: number;
      permissions: string;
    }
  | {
      action: "mmap-guard";
      mapping: string;
      targetStart: string;
      sizeBytes: number;
      permissions: "---p";
    };

export interface TargetGuestPrivateMemoryRestorePlan {
  state: "planned" | "refused";
  steps: TargetGuestPrivateMemoryRestoreStep[];
  refusals: NativeProcessImageRefusal[];
}

export function planTargetGuestPrivateMemoryRestore(
  entries: TargetGuestMemoryMaterializationEntry[],
): TargetGuestPrivateMemoryRestorePlan {
  const planned = entries.map((entry) => planEntry(entry));
  const refusals = planned.flatMap((item) => item.refusals);
  return {
    state: refusals.length === 0 ? "planned" : "refused",
    steps: planned.flatMap((item) => item.steps),
    refusals,
  };
}

function planEntry(entry: TargetGuestMemoryMaterializationEntry): {
  steps: TargetGuestPrivateMemoryRestoreStep[];
  refusals: NativeProcessImageRefusal[];
} {
  const refusal = unsafeEntryRefusal(entry);
  if (refusal) {
    return { steps: [], refusals: [refusal] };
  }
  if (entry.kind === "recreate-guard") {
    return {
      steps: [
        {
          action: "mmap-guard",
          mapping: entry.mapping,
          targetStart: entry.targetStart,
          sizeBytes: entry.sizeBytes,
          permissions: "---p",
        },
      ],
      refusals: [],
    };
  }
  return {
    steps: [
      {
        action: "mmap-private-writable",
        mapping: entry.mapping,
        targetStart: entry.targetStart,
        sizeBytes: entry.sizeBytes,
        permissions: "rw-p",
      },
      {
        action: "copy-captured-bytes",
        mapping: entry.mapping,
        sourceFile: entry.sourceFile,
        sourceOffset: entry.sourceOffset,
        targetStart: entry.targetStart,
        sizeBytes: entry.sizeBytes,
      },
      {
        action: "mprotect-final",
        mapping: entry.mapping,
        targetStart: entry.targetStart,
        sizeBytes: entry.sizeBytes,
        permissions: entry.permissions,
      },
    ],
    refusals: [],
  };
}

function unsafeEntryRefusal(
  entry: TargetGuestMemoryMaterializationEntry,
): NativeProcessImageRefusal | undefined {
  if (entry.permissions.includes("x")) {
    return refusal(
      "mapping-executable-unsupported",
      `${entry.mapping} executable memory is not private data`,
    );
  }
  if (entry.permissions.endsWith("s")) {
    return refusal(
      "mapping-shared-unsupported",
      `${entry.mapping} shared memory is not target-private`,
    );
  }
  if (entry.kind === "copy-captured-bytes" && !entry.permissions.includes("w")) {
    return refusal(
      "mapping-permission-unsupported",
      `${entry.mapping} copied private memory must be writable`,
    );
  }
  if (entry.kind === "recreate-guard" && entry.permissions !== "---p") {
    return refusal(
      "mapping-permission-unsupported",
      `${entry.mapping} guard mapping must be no-access private`,
    );
  }
  return undefined;
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeProcessImageRefusal {
  return { code, message };
}
