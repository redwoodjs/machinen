import { describe, expect, it } from "vitest";

import {
  buildPortableSnapshotGuestCriuCompositionRow,
  summarizePortableSnapshotGuestCriuCompositionRows,
} from "../portable-snapshot-guest-criu-composition.ts";

const base = {
  sourceArch: "arm64",
  targetArch: "arm64",
  machinenStateModel: "same-arch-vmstate" as const,
  guestCriuVersion: "Version: 4.2",
  preSnapshotGuestCriuVerifier: "pre=8 post=15 restoredPid=770",
  postRestoreGuestCriuVerifier: "pre=8 post=16 restoredPid=812",
  storedCriuImageDigest: "sha256:abc123",
  storedCriuImageReadableAfterRestore: true,
};

describe("portable snapshot plus guest CRIU composition summaries", () => {
  it("accepts same-arch Machinen restore with pre/post guest CRIU verifiers", () => {
    const row = buildPortableSnapshotGuestCriuCompositionRow(base);
    expect(row).toMatchObject({
      kind: "machinen.cross-arch-criu.portable-snapshot-guest-criu-composition",
      state: "completed",
      migrationCompleted: true,
      machinenStateModel: "same-arch-vmstate",
      scope: {
        guestCriuSameIsaOnly: true,
        crossIsaCriuImageRestoreClaimed: false,
      },
    });
  });

  it("refuses cross-ISA CRIU image replay claims", () => {
    const row = buildPortableSnapshotGuestCriuCompositionRow({
      ...base,
      targetArch: "amd64",
      machinenStateModel: "unsupported-cross-isa-criu-replay",
    });
    expect(row).toMatchObject({
      state: "refused",
      migrationCompleted: false,
      refusalCode: "cross-isa-criu-image-restore-unsupported",
    });
  });

  it("refuses missing post-restore verifier output", () => {
    const row = buildPortableSnapshotGuestCriuCompositionRow({
      ...base,
      postRestoreGuestCriuVerifier: "",
    });
    expect(row).toMatchObject({
      state: "refused",
      refusalCode: "composition-verifier-missing-or-ambiguous",
    });
  });

  it("summarizes completed and refused rows", () => {
    const summary = summarizePortableSnapshotGuestCriuCompositionRows([
      buildPortableSnapshotGuestCriuCompositionRow(base),
      buildPortableSnapshotGuestCriuCompositionRow({
        ...base,
        targetArch: "amd64",
        machinenStateModel: "unsupported-cross-isa-criu-replay",
      }),
    ]);
    expect(summary).toMatchObject({ pass: true, completedRows: 1, refusedRows: 1 });
  });
});
