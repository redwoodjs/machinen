import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  verifyNodeLevel5FrameworkProductEvidenceReport,
  writeNodeLevel5FrameworkProductEvidenceReport,
} from "../../../packages/runtime/src/node-level5-framework-product-evidence.ts";

type FrameworkProductEvidenceSummary = {
  kind: "machinen.node-level5-framework-product-evidence-summary";
  accepted: boolean;
  outDir: string;
  reportPath: string;
  artifactCount: number;
  graphArtifactCount: number;
  restoredBehaviorProbeCount: number;
  refusalArtifactCount: number;
  claimReadyCommand: string[];
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generateFrameworkProductEvidence(options.outDir);
  process.stdout.write(
    options.json ? `${JSON.stringify(summary, null, 2)}\n` : `wrote ${summary.reportPath}\n`,
  );
}

export function generateFrameworkProductEvidence(outDir: string): FrameworkProductEvidenceSummary {
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, "node-level5-framework-product-evidence-report.json");
  const report = writeNodeLevel5FrameworkProductEvidenceReport({ outDir, path: reportPath });
  const verification = verifyNodeLevel5FrameworkProductEvidenceReport(report);
  const summary: FrameworkProductEvidenceSummary = {
    kind: "machinen.node-level5-framework-product-evidence-summary",
    accepted: verification.accepted,
    outDir,
    reportPath,
    artifactCount: verification.artifactCount,
    graphArtifactCount: verification.graphArtifactCount,
    restoredBehaviorProbeCount: verification.restoredBehaviorProbeCount,
    refusalArtifactCount: verification.refusalArtifactCount,
    claimReadyCommand: [
      "machinen",
      "node-level5",
      "framework-claim-ready",
      "--framework-product-evidence-report",
      reportPath,
    ],
  };
  writeFileSync(
    join(outDir, "node-level5-framework-product-evidence-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function parseArgs(args: string[]): { outDir: string; json: boolean } {
  const outDir = valueAfterFlag(args, "--out");
  if (!outDir) {
    throw new Error("usage: node-level5-framework-product-evidence --out <dir> [--json]");
  }
  return { outDir, json: args.includes("--json") };
}

function valueAfterFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1]?.endsWith("node-level5-framework-product-evidence.ts")) {
  main();
}
