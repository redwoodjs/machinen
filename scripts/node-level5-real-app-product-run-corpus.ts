import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  verifyNodeLevel5RealAppCorpusReport,
  writeNodeLevel5RealAppCorpusReport,
  type NodeLevel5RealAppCorpusFramework,
  type NodeLevel5RealAppCorpusRow,
} from "../packages/runtime/src/node-level5-real-app-corpus.ts";
import type {
  NodeLevel5ProductBehavioralVerifierReport,
  NodeLevel5ProductRestoreSummary,
  NodeLevel5ProductSnapshotDirection,
  NodeLevel5ProductSnapshotSummary,
} from "../packages/runtime/src/node-level5-product-snapshot.ts";
import {
  isNodeLevel5RealAppCorpusMain,
  nodeLevel5RealAppCorpusDirections,
  nodeLevel5RealAppCorpusFrameworks,
  parseNodeLevel5RealAppCorpusOutArgs,
  nodeLevel5HttpServerSourceForRoutes,
  runNodeLevel5RealAppCorpusCliJson,
  runNodeLevel5SnapshotRestoreForApp,
  selectedNodeLevel5BehavioralHeaders,
  spawnNodeLevel5RealAppCorpusTarget,
  stopNodeLevel5RealAppCorpusTarget,
  writeNodeLevel5RealAppFixturePackageJson,
} from "./node-level5-real-app-corpus-script-utils.ts";

type ProductRunCorpusSummary = {
  kind: "machinen.node-level5-real-app-product-run-corpus-summary";
  accepted: boolean;
  outDir: string;
  corpusReportPath: string;
  rowCount: number;
  rows: NodeLevel5RealAppCorpusRow[];
  corpusVerification: ReturnType<typeof verifyNodeLevel5RealAppCorpusReport>;
  releaseGate: Record<string, unknown>;
  productCommands: ["machinen snapshot node <pid> --out <dir>", "machinen restore <snapshot>"];
  productRunGenerated: true;
  harnessProof: true;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generateProductRunCorpus(options.outDir);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`wrote ${summary.corpusReportPath}\n`);
}

export function generateProductRunCorpus(outDir: string): ProductRunCorpusSummary {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const rows = nodeLevel5RealAppCorpusFrameworks.flatMap((framework) =>
    nodeLevel5RealAppCorpusDirections.map((direction) =>
      runFixtureProductCommands(outDir, framework, direction),
    ),
  );
  const corpusReportPath = join(outDir, "node-level5-real-app-corpus-report.json");
  const corpusReport = writeNodeLevel5RealAppCorpusReport({ path: corpusReportPath, rows });
  const corpusVerification = verifyNodeLevel5RealAppCorpusReport(corpusReport);
  const releaseGate = runNodeLevel5RealAppCorpusCliJson([
    "node-level5",
    "release-gate",
    "--include-real-app-corpus",
    "--corpus-report",
    corpusReportPath,
    "--json",
  ]);
  const summary: ProductRunCorpusSummary = {
    kind: "machinen.node-level5-real-app-product-run-corpus-summary",
    accepted: corpusVerification.accepted && releaseGate.accepted === true,
    outDir,
    corpusReportPath,
    rowCount: rows.length,
    rows,
    corpusVerification,
    releaseGate,
    productCommands: ["machinen snapshot node <pid> --out <dir>", "machinen restore <snapshot>"],
    productRunGenerated: true,
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  writeFileSync(
    join(outDir, "node-level5-real-app-product-run-corpus-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function runFixtureProductCommands(
  outDir: string,
  framework: NodeLevel5RealAppCorpusFramework,
  direction: NodeLevel5ProductSnapshotDirection,
): NodeLevel5RealAppCorpusRow {
  const appDir = fixtureAppDir(outDir, framework, direction);
  const snapshotDir = join(outDir, "snapshots", framework, direction);
  const child = spawnNodeLevel5RealAppCorpusTarget(appDir);
  try {
    const { snapshot, restore } = runNodeLevel5SnapshotRestoreForApp({
      child,
      appDir,
      snapshotDir,
      direction,
    });
    return rowFromProductRun(framework, direction, snapshot, restore);
  } finally {
    stopNodeLevel5RealAppCorpusTarget(child);
  }
}

function rowFromProductRun(
  framework: NodeLevel5RealAppCorpusFramework,
  direction: NodeLevel5ProductSnapshotDirection,
  snapshot: NodeLevel5ProductSnapshotSummary,
  restore: NodeLevel5ProductRestoreSummary,
): NodeLevel5RealAppCorpusRow {
  const report = restore.behavioralVerifierReport;
  return {
    framework,
    direction,
    routePath: report.routePath,
    expectedStatus: report.expectedStatus,
    actualStatus: verifierStatus(report),
    expectedBody: report.expectedBody,
    actualBody: verifierBody(report),
    expectedHeaders: report.expectedHeaders ?? {},
    actualHeaders: selectedNodeLevel5BehavioralHeaders(report),
    snapshotAccepted: snapshot.accepted,
    restoreAccepted: restore.accepted,
    behavioralVerifierPassed: restore.behavioralVerifierPassed,
    targetNativeNodeVerified: productRunTargetNativeVerified(restore, report),
  };
}

function verifierStatus(report: NodeLevel5ProductBehavioralVerifierReport): number {
  return report.actualStatus ?? 0;
}

function verifierBody(report: NodeLevel5ProductBehavioralVerifierReport): string {
  return report.actualBody ?? "";
}

function productRunTargetNativeVerified(
  restore: NodeLevel5ProductRestoreSummary,
  report: NodeLevel5ProductBehavioralVerifierReport,
): boolean {
  return restore.targetNativeNodeVerified && report.targetNativeNodeVerified;
}

function fixtureAppDir(
  outDir: string,
  framework: NodeLevel5RealAppCorpusFramework,
  direction: NodeLevel5ProductSnapshotDirection,
): string {
  const appDir = join(outDir, "fixtures", `${framework}-${direction}`);
  mkdirSync(appDir, { recursive: true });
  writeNodeLevel5RealAppFixturePackageJson(appDir, framework, "product-run-fixture");
  writeFileSync(join(appDir, "server.mjs"), serverSource(fixture(framework)));
  writeFileSync(
    join(appDir, "machinen-node-level5-behavior.json"),
    `${JSON.stringify(behaviorConfig(framework), null, 2)}\n`,
  );
  return appDir;
}

function fixture(framework: NodeLevel5RealAppCorpusFramework): {
  route: string;
  body: string;
  status: 200;
  headerValue: string;
} {
  return {
    route: framework === "express" ? "/express/health" : "/fastify/health",
    body: `${framework}-product-run-ok`,
    status: 200,
    headerValue: framework,
  };
}

function behaviorConfig(framework: NodeLevel5RealAppCorpusFramework): Record<string, unknown> {
  const current = fixture(framework);
  return {
    entry: "server.mjs",
    path: current.route,
    expectedStatus: current.status,
    expectedBody: current.body,
    expectedHeaders: { "x-machinen-fixture": current.headerValue },
  };
}

function serverSource(input: ReturnType<typeof fixture>): string {
  return nodeLevel5HttpServerSourceForRoutes({
    headerName: "x-machinen-fixture",
    headerValue: input.headerValue,
    routes: [{ path: input.route, body: input.body }],
  });
}

function parseArgs(args: string[]): { outDir: string; json: boolean } {
  return parseNodeLevel5RealAppCorpusOutArgs(
    args,
    "usage: node-level5-real-app-product-run-corpus --out <dir> [--json]",
  );
}

if (isNodeLevel5RealAppCorpusMain(import.meta.url)) {
  main();
}
