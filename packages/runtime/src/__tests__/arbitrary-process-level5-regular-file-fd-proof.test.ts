import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createArbitraryProcessLevel5RegularFileFdProof,
  loadArbitraryProcessLevel5RegularFileFdProofReport,
  verifyArbitraryProcessLevel5RegularFileFdProofReport,
} from "../arbitrary-process-level5-regular-file-fd-proof.ts";

describe("arbitrary process Level 5 regular file FD proof", () => {
  it("proves target-native regular file FD reconstruction without raising the claim", () => {
    const outDir = mkdtempSync(join(tmpdir(), "machinen-regular-file-fd-proof-"));
    const report = createArbitraryProcessLevel5RegularFileFdProof({
      outDir,
      sourceArch: "arm64",
      targetArch: "amd64",
    });

    expect(report).toMatchObject({
      accepted: true,
      rowId: "native-regular-file-fd",
      proofStatus: "verified-seed",
      sourceArch: "arm64",
      targetArch: "amd64",
      targetReconstruction: {
        planKind: "reopen-file",
        targetFd: 3,
        rawCpuRestoreUsed: false,
        sourceIsaEmulationUsed: false,
        appCheckpointHooksRequired: false,
        metadataOnlySuccessAccepted: false,
      },
      verifier: {
        readStartedAtCapturedOffset: true,
        readBytesSha256Matched: true,
        targetNativeReconstructionRequired: true,
        translatedProcessStateRequired: true,
      },
      claimChangeAllowed: false,
      currentArbitraryProcessCrossArchRestoreClaimed: 0,
      candidateArbitraryProcessCrossArchRestoreClaimed: 1,
      arbitraryProcessClaimed: false,
    });
    expect(report.artifacts.map((artifact) => artifact.name)).toEqual([
      "source-capture.json",
      "target-reconstruction-plan.json",
      "target-verifier.json",
    ]);

    const loaded = loadArbitraryProcessLevel5RegularFileFdProofReport(
      join(outDir, "regular-file-fd-proof-report.json"),
    );
    expect(verifyArbitraryProcessLevel5RegularFileFdProofReport(loaded).accepted).toBe(true);
  });
});
