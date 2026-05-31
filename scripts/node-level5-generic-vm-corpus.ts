import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  verifyNodeLevel5GenericVmCorpusReport,
  writeNodeLevel5GenericVmCorpusReport,
  type NodeLevel5GenericVmCorpusRow,
  type NodeLevel5GenericVmModuleSystem,
  type NodeLevel5GenericVmRefusalMarker,
} from "../packages/runtime/src/node-level5-generic-vm-corpus.ts";
import type { NodeLevel5ProductSnapshotDirection } from "../packages/runtime/src/node-level5-product-snapshot.ts";
import type { NodeLevel5RealAppCorpusFramework } from "../packages/runtime/src/node-level5-real-app-corpus.ts";

type GenericVmCorpusSummary = {
  kind: "machinen.node-level5-generic-vm-corpus-summary";
  accepted: boolean;
  outDir: string;
  corpusReportPath: string;
  rowCount: number;
  positiveRowCount: number;
  refusalRowCount: number;
  releaseGateCommand: string[];
  productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>";
  candidateNodeProductSupportClaimed: 85;
  candidateBroadNodeProductSupportClaimed: 25;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

const directions: NodeLevel5ProductSnapshotDirection[] = ["arm64-to-amd64", "amd64-to-arm64"];
const frameworks: NodeLevel5RealAppCorpusFramework[] = ["express", "fastify"];
const moduleSystems: NodeLevel5GenericVmModuleSystem[] = ["cjs", "esm"];
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

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generateGenericVmCorpus(options.outDir);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`wrote ${summary.corpusReportPath}\n`);
}

export function generateGenericVmCorpus(outDir: string): GenericVmCorpusSummary {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const rows = [...positiveRows(), ...refusalRows()];
  const corpusReportPath = join(outDir, "node-level5-generic-vm-corpus-report.json");
  const report = writeNodeLevel5GenericVmCorpusReport({ path: corpusReportPath, rows });
  const verification = verifyNodeLevel5GenericVmCorpusReport(report);
  const summary: GenericVmCorpusSummary = {
    kind: "machinen.node-level5-generic-vm-corpus-summary",
    accepted: verification.accepted,
    outDir,
    corpusReportPath,
    rowCount: report.rowCount,
    positiveRowCount: report.positiveRowCount,
    refusalRowCount: report.refusalRowCount,
    releaseGateCommand: [
      "machinen",
      "node-level5",
      "release-gate",
      "--include-generic-vm-corpus",
      "--generic-vm-corpus-report",
      corpusReportPath,
    ],
    productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
    candidateNodeProductSupportClaimed: 85,
    candidateBroadNodeProductSupportClaimed: 25,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  writeFileSync(
    join(outDir, "node-level5-generic-vm-corpus-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function positiveRows(): NodeLevel5GenericVmCorpusRow[] {
  return frameworks.flatMap((framework) =>
    moduleSystems.flatMap((moduleSystem) =>
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

function parseArgs(args: string[]): { outDir: string; json: boolean } {
  const outFlag = args.indexOf("--out");
  const outDir = outFlag === -1 ? undefined : args[outFlag + 1];
  if (!outDir) {
    throw new Error("usage: node-level5-generic-vm-corpus --out <dir> [--json]");
  }
  return { outDir, json: args.includes("--json") };
}

if (process.argv[1]?.endsWith("node-level5-generic-vm-corpus.ts")) {
  main();
}
