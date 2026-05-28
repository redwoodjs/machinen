import { describe, expect, it } from "vitest";

import {
  buildPortableSnapshotGuestCheckpointCompositionRow,
  summarizePortableSnapshotGuestCheckpointCompositionRows,
} from "../portable-snapshot-guest-checkpoint-composition.ts";

const base = {
  sourceArch: "arm64",
  targetArch: "arm64",
  machinenStateModel: "same-arch-vmstate" as const,
  guestCheckpointVersion: "Version: 4.2",
  preSnapshotGuestCheckpointVerifier: "pre=8 post=15 restoredPid=770",
  postRestoreGuestCheckpointVerifier: "pre=8 post=16 restoredPid=812",
  storedCheckpointImageDigest: "sha256:abc123",
  storedCheckpointImageReadableAfterRestore: true,
};

describe("portable snapshot plus guest checkpoint composition summaries", () => {
  it("accepts same-arch Machinen restore with pre/post guest checkpoint verifiers", () => {
    const row = buildPortableSnapshotGuestCheckpointCompositionRow(base);
    expect(row).toMatchObject({
      kind: "machinen.architecture-portable-snapshot.portable-snapshot-guest-checkpoint-composition",
      state: "completed",
      migrationCompleted: true,
      machinenStateModel: "same-arch-vmstate",
      scope: {
        guestCheckpointSameIsaOnly: true,
        crossIsaCheckpointImageRestoreClaimed: false,
      },
    });
  });

  it("refuses cross-ISA checkpoint replay claims", () => {
    const row = buildPortableSnapshotGuestCheckpointCompositionRow({
      ...base,
      targetArch: "amd64",
      machinenStateModel: "unsupported-cross-isa-checkpoint-replay",
    });
    expect(row).toMatchObject({
      state: "refused",
      migrationCompleted: false,
      refusalCode: "cross-isa-checkpoint-image-restore-unsupported",
    });
  });

  it("refuses missing post-restore verifier output", () => {
    const row = buildPortableSnapshotGuestCheckpointCompositionRow({
      ...base,
      postRestoreGuestCheckpointVerifier: "",
    });
    expect(row).toMatchObject({
      state: "refused",
      refusalCode: "composition-verifier-missing-or-ambiguous",
    });
  });

  it("summarizes completed and refused rows", () => {
    const summary = summarizePortableSnapshotGuestCheckpointCompositionRows([
      buildPortableSnapshotGuestCheckpointCompositionRow(base),
      buildPortableSnapshotGuestCheckpointCompositionRow({
        ...base,
        targetArch: "amd64",
        machinenStateModel: "unsupported-cross-isa-checkpoint-replay",
      }),
    ]);
    expect(summary).toMatchObject({ pass: true, completedRows: 1, refusedRows: 1 });
  });
});
