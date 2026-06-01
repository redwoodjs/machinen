import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadNodeLevel5GenericVmCorpusReport } from "../../../packages/runtime/src/node-level5-generic-vm-corpus.ts";
import {
  verifyNodeLevel5GenericVmRefusalArtifactsReport,
  writeNodeLevel5GenericVmRefusalArtifactsReport,
} from "../../../packages/runtime/src/node-level5-generic-vm-refusal-artifacts.ts";

type GenericVmRefusalArtifactsSummary = {
  kind: "machinen.node-level5-generic-vm-refusal-artifacts-summary";
  accepted: boolean;
  outDir: string;
  corpusReportPath: string;
  refusalArtifactsReportPath: string;
  refusalArtifactFileCount: number;
  markersCovered: string[];
  releaseGateCommand: string[];
  claimChangeAllowed: false;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generateGenericVmRefusalArtifacts(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`wrote ${summary.refusalArtifactsReportPath}\n`);
}

export function generateGenericVmRefusalArtifacts(input: {
  corpusReportPath: string;
  outDir: string;
}): GenericVmRefusalArtifactsSummary {
  mkdirSync(input.outDir, { recursive: true });
  const corpusReport = loadNodeLevel5GenericVmCorpusReport(input.corpusReportPath);
  const refusalArtifactsReportPath = join(
    input.outDir,
    "node-level5-generic-vm-refusal-artifacts-report.json",
  );
  const report = writeNodeLevel5GenericVmRefusalArtifactsReport({
    corpusReport,
    outDir: input.outDir,
    path: refusalArtifactsReportPath,
  });
  const verification = verifyNodeLevel5GenericVmRefusalArtifactsReport(report);
  const summary: GenericVmRefusalArtifactsSummary = {
    kind: "machinen.node-level5-generic-vm-refusal-artifacts-summary",
    accepted: verification.accepted,
    outDir: input.outDir,
    corpusReportPath: input.corpusReportPath,
    refusalArtifactsReportPath,
    refusalArtifactFileCount: verification.refusalArtifactFileCount,
    markersCovered: verification.markersCovered,
    releaseGateCommand: [
      "machinen",
      "node-level5",
      "release-gate",
      "--include-generic-vm-refusal-artifacts",
      "--generic-vm-refusal-artifacts-report",
      refusalArtifactsReportPath,
    ],
    claimChangeAllowed: false,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  writeFileSync(
    join(input.outDir, "node-level5-generic-vm-refusal-artifacts-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function parseArgs(args: string[]): { corpusReportPath: string; outDir: string; json: boolean } {
  const values = new Map(
    ["--generic-vm-corpus-report", "--out"].map((flag) => [flag, args[args.indexOf(flag) + 1]]),
  );
  const corpusReportPath = values.get("--generic-vm-corpus-report");
  const outDir = values.get("--out");
  if (!corpusReportPath || !outDir) {
    throw new Error(
      "usage: node-level5-generic-vm-refusal-artifacts --generic-vm-corpus-report <file> --out <dir> [--json]",
    );
  }
  return { corpusReportPath, outDir, json: args.includes("--json") };
}

if (process.argv[1]?.endsWith("node-level5-generic-vm-refusal-artifacts.ts")) {
  main();
}
