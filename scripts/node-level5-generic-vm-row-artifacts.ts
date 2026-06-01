import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadNodeLevel5GenericVmCorpusReport } from "../packages/runtime/src/node-level5-generic-vm-corpus.ts";
import {
  verifyNodeLevel5GenericVmRowArtifactsReport,
  writeNodeLevel5GenericVmRowArtifactsReport,
} from "../packages/runtime/src/node-level5-generic-vm-row-artifacts.ts";

type GenericVmRowArtifactsSummary = {
  kind: "machinen.node-level5-generic-vm-row-artifacts-summary";
  accepted: boolean;
  outDir: string;
  corpusReportPath: string;
  rowArtifactsReportPath: string;
  rowArtifactFileCount: number;
  positiveRowCount: number;
  refusalRowCount: number;
  releaseGateCommand: string[];
  claimChangeAllowed: false;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generateGenericVmRowArtifacts(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`wrote ${summary.rowArtifactsReportPath}\n`);
}

export function generateGenericVmRowArtifacts(input: {
  corpusReportPath: string;
  outDir: string;
}): GenericVmRowArtifactsSummary {
  mkdirSync(input.outDir, { recursive: true });
  const corpusReport = loadNodeLevel5GenericVmCorpusReport(input.corpusReportPath);
  const rowArtifactsReportPath = join(
    input.outDir,
    "node-level5-generic-vm-row-artifacts-report.json",
  );
  const report = writeNodeLevel5GenericVmRowArtifactsReport({
    corpusReport,
    outDir: input.outDir,
    path: rowArtifactsReportPath,
  });
  const verification = verifyNodeLevel5GenericVmRowArtifactsReport(report);
  const summary: GenericVmRowArtifactsSummary = {
    kind: "machinen.node-level5-generic-vm-row-artifacts-summary",
    accepted: verification.accepted,
    outDir: input.outDir,
    corpusReportPath: input.corpusReportPath,
    rowArtifactsReportPath,
    rowArtifactFileCount: verification.rowArtifactFileCount,
    positiveRowCount: verification.positiveRowCount,
    refusalRowCount: verification.refusalRowCount,
    releaseGateCommand: [
      "machinen",
      "node-level5",
      "release-gate",
      "--include-generic-vm-row-artifacts",
      "--generic-vm-row-artifacts-report",
      rowArtifactsReportPath,
    ],
    claimChangeAllowed: false,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  writeFileSync(
    join(input.outDir, "node-level5-generic-vm-row-artifacts-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function parseArgs(args: string[]): { corpusReportPath: string; outDir: string; json: boolean } {
  const corpusReportPath = valueAfter(args, "--generic-vm-corpus-report");
  const outDir = valueAfter(args, "--out");
  if (!corpusReportPath || !outDir) {
    throw new Error(
      "usage: node-level5-generic-vm-row-artifacts --generic-vm-corpus-report <file> --out <dir> [--json]",
    );
  }
  return { corpusReportPath, outDir, json: args.includes("--json") };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

if (process.argv[1]?.endsWith("node-level5-generic-vm-row-artifacts.ts")) {
  main();
}
