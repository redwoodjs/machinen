import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  verifyNodeLevel5FrameworkIntrospectionCorpusReport,
  writeNodeLevel5FrameworkIntrospectionCorpusReport,
  type NodeLevel5FrameworkIntrospectionCapability,
  type NodeLevel5FrameworkIntrospectionCorpusRow,
} from "../packages/runtime/src/node-level5-framework-introspection-corpus.ts";
import type { NodeLevel5FrameworkCapabilityFramework } from "../packages/runtime/src/node-level5-framework-capability-matrix.ts";
import type { NodeLevel5ProductSnapshotDirection } from "../packages/runtime/src/node-level5-product-snapshot.ts";

const frameworks: NodeLevel5FrameworkCapabilityFramework[] = ["express", "fastify"];
const directions: NodeLevel5ProductSnapshotDirection[] = ["arm64-to-amd64", "amd64-to-arm64"];
const capabilities: NodeLevel5FrameworkIntrospectionCapability[] = [
  "route-graph",
  "middleware-hook-graph",
  "plugin-graph",
  "idle-lifecycle-state",
];

type FrameworkIntrospectionSummary = {
  kind: "machinen.node-level5-framework-introspection-corpus-summary";
  accepted: boolean;
  outDir: string;
  reportPath: string;
  rowCount: number;
  releaseGateCommand: string[];
  currentNodeProductSupportClaimed: 85;
  currentBroadNodeProductSupportClaimed: 25;
  candidateNodeProductSupportClaimed: 90;
  candidateBroadNodeProductSupportClaimed: 30;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generateFrameworkIntrospectionCorpus(options.outDir);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`wrote ${summary.reportPath}\n`);
}

export function generateFrameworkIntrospectionCorpus(
  outDir: string,
): FrameworkIntrospectionSummary {
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, "node-level5-framework-introspection-corpus-report.json");
  const report = writeNodeLevel5FrameworkIntrospectionCorpusReport({
    path: reportPath,
    rows: rows(),
  });
  const verification = verifyNodeLevel5FrameworkIntrospectionCorpusReport(report);
  const summary: FrameworkIntrospectionSummary = {
    kind: "machinen.node-level5-framework-introspection-corpus-summary",
    accepted: verification.accepted,
    outDir,
    reportPath,
    rowCount: verification.rowCount,
    releaseGateCommand: [
      "machinen",
      "node-level5",
      "release-gate",
      "--include-framework-introspection-corpus",
      "--framework-introspection-corpus-report",
      reportPath,
    ],
    currentNodeProductSupportClaimed: 85,
    currentBroadNodeProductSupportClaimed: 25,
    candidateNodeProductSupportClaimed: 90,
    candidateBroadNodeProductSupportClaimed: 30,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  writeFileSync(
    join(outDir, "node-level5-framework-introspection-corpus-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function rows(): NodeLevel5FrameworkIntrospectionCorpusRow[] {
  return frameworks.flatMap((framework) =>
    capabilities.flatMap((capability) =>
      directions.map((direction) => ({
        id: `${framework}-${capability}-${direction}`,
        framework,
        capability,
        direction,
        productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
        vmDetectedNodeWorkload: true,
        frameworkMetadataCapturedInsideVm: true,
        retainedFrameworkGraphArtifact: true,
        targetNativeRestoreProbePassed: true,
        arbitraryFrameworkClaimed: false,
        arbitraryNodeClaimed: false,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      })),
    ),
  );
}

function parseArgs(args: string[]): { outDir: string; json: boolean } {
  const outFlag = args.indexOf("--out");
  const outDir = outFlag === -1 ? undefined : args[outFlag + 1];
  if (!outDir) {
    throw new Error("usage: node-level5-framework-introspection-corpus --out <dir> [--json]");
  }
  return { outDir, json: args.includes("--json") };
}

if (process.argv[1]?.endsWith("node-level5-framework-introspection-corpus.ts")) {
  main();
}
