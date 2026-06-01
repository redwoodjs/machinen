import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createNodeLevel5GenericVmRetainedEvidenceReport,
  loadNodeLevel5GenericVmRetainedEvidenceReport,
  verifyNodeLevel5GenericVmRetainedEvidenceReport,
  writeNodeLevel5GenericVmRetainedEvidenceReport,
} from "../node-level5-generic-vm-retained-evidence.ts";

describe("Node Level 5 generic VM retained evidence", () => {
  it("records and verifies retained VM-detected snapshot/restore files", () => {
    const workDir = writeRetainedEvidenceFixture();
    try {
      const report = createNodeLevel5GenericVmRetainedEvidenceReport({ workDir });

      expect(report).toMatchObject({
        accepted: true,
        retainedFileCount: 6,
        vmDetectedNodeWorkload: true,
        restoreProbePassed: true,
        claimChangeAllowed: false,
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      });
      expect(verifyNodeLevel5GenericVmRetainedEvidenceReport(report)).toMatchObject({
        accepted: true,
        retainedFilesSha256Verified: true,
      });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("round-trips retained evidence reports", () => {
    const workDir = writeRetainedEvidenceFixture();
    const reportPath = join(workDir, "retained-evidence.json");
    try {
      writeNodeLevel5GenericVmRetainedEvidenceReport({ workDir, path: reportPath });
      expect(
        verifyNodeLevel5GenericVmRetainedEvidenceReport(
          loadNodeLevel5GenericVmRetainedEvidenceReport(reportPath),
        ),
      ).toMatchObject({ accepted: true, retainedFileCount: 6 });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

function writeRetainedEvidenceFixture(): string {
  const workDir = mkFixtureDir();
  mkdirSync(join(workDir, "snap"), { recursive: true });
  writeFileSync(
    join(workDir, "snapshot.json"),
    JSON.stringify({ snap_dir: join(workDir, "snap") }),
  );
  writeFileSync(join(workDir, "restore.log"), "restored as node-level5-detected-restored\n");
  writeFileSync(
    join(workDir, "snap/portable-node.json"),
    JSON.stringify({ runtime: "node", subset: "node-http-clean-root-v1" }),
  );
  writeFileSync(join(workDir, "snap/portable-node-app.tar.gz"), "app");
  writeFileSync(join(workDir, "snap/portable-clean-service.json"), "{}\n");
  writeFileSync(join(workDir, "snap/clean-service-node-primary.tar.gz"), "clean-service");
  return workDir;
}

function mkFixtureDir(): string {
  return join(tmpdir(), `machinen-node-level5-retained-${process.pid}-${Date.now()}`);
}
