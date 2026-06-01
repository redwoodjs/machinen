import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  verifyNodeLevel5GenericVmRetainedEvidenceReport,
  writeNodeLevel5GenericVmRetainedEvidenceReport,
} from "../packages/runtime/src/node-level5-generic-vm-retained-evidence.ts";

type GenericVmRetainedEvidenceSummary = {
  kind: "machinen.node-level5-generic-vm-retained-evidence-summary";
  accepted: boolean;
  workDir: string;
  reportPath: string;
  retainedFileCount: number;
  releaseGateCommand: string[];
  readinessCommand: string[];
  claimChangeAllowed: false;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generateGenericVmRetainedEvidence(
    options.workDir,
    options.out ?? options.workDir,
  );
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`wrote ${summary.reportPath}\n`);
}

export function generateGenericVmRetainedEvidence(
  workDir: string,
  outDir: string,
): GenericVmRetainedEvidenceSummary {
  const reportPath = join(outDir, "node-level5-generic-vm-retained-evidence-report.json");
  const report = writeNodeLevel5GenericVmRetainedEvidenceReport({ workDir, path: reportPath });
  const verification = verifyNodeLevel5GenericVmRetainedEvidenceReport(report);
  const summary: GenericVmRetainedEvidenceSummary = {
    kind: "machinen.node-level5-generic-vm-retained-evidence-summary",
    accepted: verification.accepted,
    workDir,
    reportPath,
    retainedFileCount: verification.retainedFileCount,
    releaseGateCommand: [
      "machinen",
      "node-level5",
      "release-gate",
      "--include-generic-vm-retained-evidence",
      "--generic-vm-retained-evidence-report",
      reportPath,
    ],
    readinessCommand: [
      "machinen",
      "node-level5",
      "85-readiness",
      "--generic-vm-retained-evidence-report",
      reportPath,
    ],
    claimChangeAllowed: false,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  writeFileSync(
    join(outDir, "node-level5-generic-vm-retained-evidence-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function parseArgs(args: string[]): { workDir: string; out?: string; json: boolean } {
  const workDir = valueAfter(args, "--work-dir");
  if (!workDir) {
    throw new Error(
      "usage: node-level5-generic-vm-retained-evidence --work-dir <dir> [--out <dir>] [--json]",
    );
  }
  return { workDir, out: valueAfter(args, "--out"), json: args.includes("--json") };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

if (process.argv[1]?.endsWith("node-level5-generic-vm-retained-evidence.ts")) {
  main();
}
