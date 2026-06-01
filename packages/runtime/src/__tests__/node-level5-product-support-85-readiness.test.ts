import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createNodeLevel5GenericVmCorpusReport,
  type NodeLevel5GenericVmCorpusRow,
  type NodeLevel5GenericVmRefusalMarker,
  type NodeLevel5GenericVmRefusalRow,
} from "../node-level5-generic-vm-corpus.ts";
import type { NodeLevel5GenericVmRefusalArtifactsReport } from "../node-level5-generic-vm-refusal-artifacts.ts";
import type { NodeLevel5GenericVmRetainedEvidenceReport } from "../node-level5-generic-vm-retained-evidence.ts";
import { evaluateNodeLevel5ProductSupport85Readiness } from "../node-level5-product-support-85-readiness.ts";
import type { NodeLevel5ProductSnapshotDirection } from "../node-level5-product-snapshot.ts";
import type { NodeLevel5RealAppCorpusFramework } from "../node-level5-real-app-corpus.ts";

const frameworks: NodeLevel5RealAppCorpusFramework[] = ["express", "fastify"];
const directions: NodeLevel5ProductSnapshotDirection[] = ["arm64-to-amd64", "amd64-to-arm64"];
const markerCodes: Array<{
  marker: NodeLevel5GenericVmRefusalMarker;
  id: string;
  code:
    | "node-level5-active-request-refused"
    | "node-level5-worker-thread-refused"
    | "node-level5-native-addon-refused"
    | "node-level5-tls-active-state-refused"
    | "node-level5-child-process-live-state-refused";
}> = [
  { marker: "activeRequests", id: "active-requests", code: "node-level5-active-request-refused" },
  { marker: "workerThreads", id: "worker-threads", code: "node-level5-worker-thread-refused" },
  { marker: "nativeAddons", id: "native-addons", code: "node-level5-native-addon-refused" },
  {
    marker: "tlsActiveState",
    id: "tls-active-state",
    code: "node-level5-tls-active-state-refused",
  },
  {
    marker: "childProcesses",
    id: "child-processes",
    code: "node-level5-child-process-live-state-refused",
  },
];

describe("Node Level 5 product support 85 readiness", () => {
  it("accepts candidate evidence but keeps claim shift locked", () => {
    const report = evaluateNodeLevel5ProductSupport85Readiness({
      genericVmCorpusReport: createNodeLevel5GenericVmCorpusReport(genericVmRows()),
    });

    expect(report).toMatchObject({
      accepted: false,
      candidateEvidenceAccepted: true,
      claimChangeAllowed: false,
      currentNodeProductSupportClaimed: 80,
      currentBroadNodeProductSupportClaimed: 20,
      currentArbitraryProcessCrossArchRestoreClaimed: 0,
      candidateNodeProductSupportClaimed: 85,
      candidateBroadNodeProductSupportClaimed: 25,
      candidateArbitraryProcessCrossArchRestoreClaimed: 0,
    });
    expect(report.blockedGates).toEqual([
      expect.objectContaining({ id: "claim-change-unlocked", status: "blocked" }),
    ]);
  });

  it("includes retained evidence gates when a retained report is provided", () => {
    const report = evaluateNodeLevel5ProductSupport85Readiness({
      genericVmCorpusReport: createNodeLevel5GenericVmCorpusReport(genericVmRows()),
      genericVmRetainedEvidenceReport: retainedEvidenceReport(),
    });

    expect(report.candidateEvidenceAccepted).toBe(true);
    expect(report.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "generic-vm-retained-evidence-accepted", status: "passed" }),
        expect.objectContaining({ id: "generic-vm-retained-evidence-files", status: "passed" }),
      ]),
    );
    expect(report.blockedGates).toEqual([
      expect.objectContaining({ id: "claim-change-unlocked", status: "blocked" }),
    ]);
  });

  it("includes refusal artifact gates when refusal artifacts are provided", () => {
    const report = evaluateNodeLevel5ProductSupport85Readiness({
      genericVmCorpusReport: createNodeLevel5GenericVmCorpusReport(genericVmRows()),
      genericVmRefusalArtifactsReport: refusalArtifactsReport(),
    });

    expect(report.candidateEvidenceAccepted).toBe(true);
    expect(report.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "generic-vm-refusal-artifacts-accepted", status: "passed" }),
        expect.objectContaining({ id: "generic-vm-refusal-artifacts-complete", status: "passed" }),
      ]),
    );
    expect(report.blockedGates).toEqual([
      expect.objectContaining({ id: "claim-change-unlocked", status: "blocked" }),
    ]);
  });

  it("blocks incomplete candidate evidence", () => {
    const report = evaluateNodeLevel5ProductSupport85Readiness({
      genericVmCorpusReport: createNodeLevel5GenericVmCorpusReport(genericVmRows().slice(0, 2)),
    });

    expect(report.accepted).toBe(false);
    expect(report.candidateEvidenceAccepted).toBe(false);
    expect(report.blockedGates.map((gate) => gate.id)).toEqual(
      expect.arrayContaining([
        "generic-vm-positive-row-count",
        "generic-vm-refusal-row-count",
        "claim-change-unlocked",
      ]),
    );
  });
});

function genericVmRows(): NodeLevel5GenericVmCorpusRow[] {
  return [...positiveRows(), ...refusalRows()];
}

function retainedEvidenceReport(): NodeLevel5GenericVmRetainedEvidenceReport {
  const retainedFiles = [
    "snapshot.json",
    "restore.log",
    "snap/portable-node.json",
    "snap/portable-node-app.tar.gz",
    "snap/portable-clean-service.json",
    "snap/clean-service-node-primary.tar.gz",
  ].map((path) => ({
    path,
    sha256: createHash("sha256").update(path).digest("hex"),
    required: true as const,
  }));
  return {
    kind: "machinen.node-level5-generic-vm-retained-evidence-report",
    version: 1,
    accepted: true,
    productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
    vmDetectedNodeWorkload: true,
    restoreProbePassed: true,
    retainedFiles,
    retainedFileCount: retainedFiles.length,
    retainedFilesSha256: createHash("sha256").update(JSON.stringify(retainedFiles)).digest("hex"),
    claimChangeAllowed: false,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

function refusalArtifactsReport(): NodeLevel5GenericVmRefusalArtifactsReport {
  const refusalArtifactFiles = refusalRows().map((row) => ({
    rowId: row.id,
    framework: row.framework,
    marker: row.marker,
    direction: row.direction,
    expectedRefusalCode: row.expectedRefusalCode,
    path: `generic-vm-refusal-artifacts/${row.id}.json`,
    sha256: createHash("sha256").update(row.id).digest("hex"),
    required: true as const,
  }));
  return {
    kind: "machinen.node-level5-generic-vm-refusal-artifacts-report",
    version: 1,
    accepted: true,
    refusalRowCount: 20,
    refusalArtifactFiles,
    refusalArtifactFileCount: refusalArtifactFiles.length,
    refusalArtifactFilesSha256: createHash("sha256")
      .update(JSON.stringify(refusalArtifactFiles))
      .digest("hex"),
    markersCovered: [
      "activeRequests",
      "childProcesses",
      "nativeAddons",
      "tlsActiveState",
      "workerThreads",
    ],
    claimChangeAllowed: false,
    candidateNodeProductSupportClaimed: 85,
    candidateBroadNodeProductSupportClaimed: 25,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

function positiveRows(): NodeLevel5GenericVmCorpusRow[] {
  return frameworks.flatMap((framework) =>
    (["cjs", "esm"] as const).flatMap((moduleSystem) =>
      directions.map((direction) => ({
        kind: "positive",
        id: `${framework}-generic-vm-${moduleSystem}-${direction}`,
        framework,
        moduleSystem,
        direction,
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
      })),
    ),
  );
}

function refusalRows(): NodeLevel5GenericVmRefusalRow[] {
  return frameworks.flatMap((framework) =>
    markerCodes.flatMap(({ marker, id, code }) =>
      directions.map((direction) => ({
        kind: "refusal",
        id: `${framework}-generic-vm-${id}-${direction}`,
        framework,
        marker,
        direction,
        productCommandPath: "machinen snapshot <vm-name> --out <dir>",
        expectedRefusalCode: code,
        actualRefusalCode: code,
        snapshotAccepted: false,
        restoreAttempted: false,
        refusedBeforeSnapshot: true,
        rawCpuRestoreUsed: false,
        sourceIsaEmulationUsed: false,
        metadataOnlySuccessAccepted: false,
      })),
    ),
  );
}
