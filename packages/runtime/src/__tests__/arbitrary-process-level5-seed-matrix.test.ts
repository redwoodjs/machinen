import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildArbitraryProcessLevel5SeedMatrix,
  loadArbitraryProcessLevel5SeedReport,
  verifyArbitraryProcessLevel5SeedReport,
  writeArbitraryProcessLevel5SeedReport,
} from "../arbitrary-process-level5-seed-matrix.ts";

describe("arbitrary process Level 5 seed matrix", () => {
  it("defines seed rows without claiming arbitrary process restore", () => {
    const matrix = buildArbitraryProcessLevel5SeedMatrix();

    expect(matrix).toMatchObject({
      accepted: true,
      rowCount: 14,
      seedCandidateRows: 7,
      refusedRows: 6,
      notProvenRows: 1,
      currentNodeProductSupportClaimed: 100,
      currentBroadNodeProductSupportClaimed: 100,
      currentArbitraryProcessCrossArchRestoreClaimed: 0,
      candidateArbitraryProcessCrossArchRestoreClaimed: 1,
      claimChangeAllowed: false,
      arbitraryProcessClaimed: false,
    });
    expect(matrix.rows.every((row) => row.rawCpuRestoreUsed === false)).toBe(true);
    expect(matrix.rows.every((row) => row.sourceIsaEmulationUsed === false)).toBe(true);
    expect(matrix.rows.every((row) => row.appCheckpointHooksRequired === false)).toBe(true);
    expect(matrix.rows.every((row) => row.proofPath === "retained proof-only seed artifact")).toBe(
      true,
    );
    expect(matrix.rows.every((row) => row.productPathArtifactsRequired === false)).toBe(true);
    expect(matrix.rows.every((row) => row.productSupportClaimAllowed === false)).toBe(true);
    expect(matrix.rows.find((row) => row.id === "native-ping-socket-resource")).toMatchObject({
      status: "seed-candidate",
      evidenceKind: "network-resource-translation-seed",
    });
    expect(matrix.rows.find((row) => row.id === "arbitrary-linux-process")).toMatchObject({
      status: "not-proven",
      arbitraryProcessClaimed: false,
    });
  });

  it("writes and verifies retained seed artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-arbitrary-process-seed-"));
    try {
      const path = join(dir, "seed-report.json");
      const report = writeArbitraryProcessLevel5SeedReport({ outDir: dir, path });

      expect(report).toMatchObject({
        accepted: true,
        artifactCount: 14,
        claimChangeAllowed: false,
        currentArbitraryProcessCrossArchRestoreClaimed: 0,
        candidateArbitraryProcessCrossArchRestoreClaimed: 1,
        arbitraryProcessClaimed: false,
        refusalMarkersCovered: [
          "active-epoll",
          "device-mmap",
          "futex-owned-locks",
          "jit-code",
          "live-sockets",
          "threads",
        ],
      });
      expect(verifyArbitraryProcessLevel5SeedReport(report)).toMatchObject({
        accepted: true,
        artifactsSha256Verified: true,
      });
      expect(
        verifyArbitraryProcessLevel5SeedReport(loadArbitraryProcessLevel5SeedReport(path)),
      ).toMatchObject({ accepted: true, rowCount: 14 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
