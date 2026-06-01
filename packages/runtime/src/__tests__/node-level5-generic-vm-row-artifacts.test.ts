import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createNodeLevel5GenericVmCorpusReport,
  type NodeLevel5GenericVmCorpusRow,
  type NodeLevel5GenericVmRefusalMarker,
} from "../node-level5-generic-vm-corpus.ts";
import {
  loadNodeLevel5GenericVmRowArtifactsReport,
  verifyNodeLevel5GenericVmRowArtifactsReport,
  writeNodeLevel5GenericVmRowArtifactsReport,
} from "../node-level5-generic-vm-row-artifacts.ts";
import type { NodeLevel5ProductSnapshotDirection } from "../node-level5-product-snapshot.ts";
import type { NodeLevel5RealAppCorpusFramework } from "../node-level5-real-app-corpus.ts";

const frameworks: NodeLevel5RealAppCorpusFramework[] = ["express", "fastify"];
const directions: NodeLevel5ProductSnapshotDirection[] = ["arm64-to-amd64", "amd64-to-arm64"];
const refusalMarkers: Array<{
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

describe("Node Level 5 generic VM row artifacts", () => {
  it("writes one retained artifact per generic VM corpus row", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node85-row-artifacts-"));
    try {
      const report = writeNodeLevel5GenericVmRowArtifactsReport({
        corpusReport: createNodeLevel5GenericVmCorpusReport(rows()),
        outDir: dir,
        path: join(dir, "row-artifacts.json"),
      });

      expect(report).toMatchObject({
        accepted: true,
        rowCount: 28,
        positiveRowCount: 8,
        refusalRowCount: 20,
        rowArtifactFileCount: 28,
        claimChangeAllowed: false,
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      });
      expect(verifyNodeLevel5GenericVmRowArtifactsReport(report)).toMatchObject({
        accepted: true,
        rowArtifactFilesSha256Verified: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips row artifact reports", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node85-row-artifacts-roundtrip-"));
    const path = join(dir, "row-artifacts.json");
    try {
      writeNodeLevel5GenericVmRowArtifactsReport({
        corpusReport: createNodeLevel5GenericVmCorpusReport(rows()),
        outDir: dir,
        path,
      });
      expect(
        verifyNodeLevel5GenericVmRowArtifactsReport(
          loadNodeLevel5GenericVmRowArtifactsReport(path),
        ),
      ).toMatchObject({ accepted: true, rowCount: 28 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function rows(): NodeLevel5GenericVmCorpusRow[] {
  return [...positiveRows(), ...refusalRows()];
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

function refusalRows(): NodeLevel5GenericVmCorpusRow[] {
  return frameworks.flatMap((framework) =>
    refusalMarkers.flatMap(({ marker, id, code }) =>
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
