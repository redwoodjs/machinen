import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createNodeLevel5GenericVmCorpusReport,
  loadNodeLevel5GenericVmCorpusReport,
  verifyNodeLevel5GenericVmCorpusReport,
  writeNodeLevel5GenericVmCorpusReport,
  type NodeLevel5GenericVmCorpusRow,
} from "../node-level5-generic-vm-corpus.ts";

const positiveRow: NodeLevel5GenericVmCorpusRow = {
  kind: "positive",
  id: "express-cjs-arm64-to-amd64",
  framework: "express",
  moduleSystem: "cjs",
  direction: "arm64-to-amd64",
  productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
  wholeVmSnapshot: true,
  nodeDetectedInsideVm: true,
  hostPidProductTargetingUsed: false,
  nodeOnlyProductSelectorUsed: false,
  snapshotAccepted: true,
  restoreAccepted: true,
  behaviorVerified: true,
  targetNativeNodeVerified: true,
  rawCpuRestoreUsed: false,
  sourceIsaEmulationUsed: false,
  metadataOnlySuccessAccepted: false,
};

const refusalRow: NodeLevel5GenericVmCorpusRow = {
  kind: "refusal",
  id: "express-worker-refusal-arm64-to-amd64",
  framework: "express",
  marker: "workerThreads",
  direction: "arm64-to-amd64",
  productCommandPath: "machinen snapshot <vm-name> --out <dir>",
  expectedRefusalCode: "node-level5-worker-thread-refused",
  actualRefusalCode: "node-level5-worker-thread-refused",
  snapshotAccepted: false,
  restoreAttempted: false,
  refusedBeforeSnapshot: true,
  rawCpuRestoreUsed: false,
  sourceIsaEmulationUsed: false,
  metadataOnlySuccessAccepted: false,
};

describe("Node Level 5 generic VM corpus", () => {
  it("verifies positive and refusal evidence without raising claims", () => {
    const report = createNodeLevel5GenericVmCorpusReport([positiveRow, refusalRow]);

    expect(report).toMatchObject({
      accepted: true,
      positiveRowCount: 1,
      refusalRowCount: 1,
      claimChangeAllowed: false,
      candidateNodeProductSupportClaimed: 85,
      candidateBroadNodeProductSupportClaimed: 25,
      nodeProductSupportClaimed: 80,
      broadNodeProductSupportClaimed: 20,
      arbitraryProcessCrossArchRestoreClaimed: 0,
    });
    expect(verifyNodeLevel5GenericVmCorpusReport(report)).toMatchObject({
      accepted: true,
      rowsSha256Verified: true,
      claimChangeAllowed: false,
    });
  });

  it("round-trips report files", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-generic-vm-corpus-"));
    const path = join(dir, "report.json");
    try {
      writeNodeLevel5GenericVmCorpusReport({ path, rows: [positiveRow, refusalRow] });
      expect(
        verifyNodeLevel5GenericVmCorpusReport(loadNodeLevel5GenericVmCorpusReport(path)),
      ).toMatchObject({
        accepted: true,
        rowCount: 2,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
