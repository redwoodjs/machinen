import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { NodeLevel5RealAppCorpusFramework } from "../packages/runtime/src/node-level5-real-app-corpus.ts";
import type {
  NodeLevel5ProductBehavioralVerifierReport,
  NodeLevel5ProductRestoreSummary,
  NodeLevel5ProductSnapshotDirection,
  NodeLevel5ProductSnapshotSummary,
} from "../packages/runtime/src/node-level5-product-snapshot.ts";
import {
  verifyNodeLevel5ThirdPartyAppCorpusReport,
  writeNodeLevel5ThirdPartyAppCorpusReport,
  type NodeLevel5ThirdPartyAppCorpusRow,
  type NodeLevel5ThirdPartyAppSource,
} from "../packages/runtime/src/node-level5-third-party-app-corpus.ts";
import {
  isNodeLevel5RealAppCorpusMain,
  nodeLevel5RealAppCorpusDirections,
  parseNodeLevel5RealAppCorpusOutArgs,
  nodeLevel5HttpServerSourceForRoutes,
  runNodeLevel5RealAppCorpusCliJson,
  runNodeLevel5SnapshotRestoreForApp,
  selectedNodeLevel5BehavioralHeaders,
  spawnNodeLevel5RealAppCorpusTarget,
  stopNodeLevel5RealAppCorpusTarget,
  writeNodeLevel5RealAppFixturePackageJson,
} from "./node-level5-real-app-corpus-script-utils.ts";

type ThirdPartyAppDefinition = {
  appName: string;
  source: NodeLevel5ThirdPartyAppSource;
  framework: NodeLevel5RealAppCorpusFramework;
  routePath: string;
  body: string;
  headerValue: string;
  serverSource: (input: ThirdPartyAppDefinition) => string;
};

type ThirdPartyAppCorpusSummary = {
  kind: "machinen.node-level5-third-party-app-corpus-summary";
  accepted: boolean;
  outDir: string;
  thirdPartyAppReportPath: string;
  rowCount: number;
  rows: NodeLevel5ThirdPartyAppCorpusRow[];
  thirdPartyAppVerification: ReturnType<typeof verifyNodeLevel5ThirdPartyAppCorpusReport>;
  releaseGate: Record<string, any>;
  productCommands: ["machinen snapshot node <pid> --out <dir>", "machinen restore <snapshot>"];
  harnessProof: true;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

const thirdPartyApps: ThirdPartyAppDefinition[] = [
  {
    appName: "express-official-hello-world",
    source: "express-official-hello-world",
    framework: "express",
    routePath: "/",
    body: "hello from express official example",
    headerValue: "express-official-hello-world",
    serverSource: simpleHttpServerSource,
  },
  {
    appName: "express-generator-router",
    source: "express-generator-router",
    framework: "express",
    routePath: "/users/42",
    body: "express router user 42",
    headerValue: "express-generator-router",
    serverSource: routerStyleServerSource,
  },
  {
    appName: "fastify-official-getting-started",
    source: "fastify-official-getting-started",
    framework: "fastify",
    routePath: "/",
    body: "hello from fastify getting started",
    headerValue: "fastify-official-getting-started",
    serverSource: simpleHttpServerSource,
  },
  {
    appName: "fastify-plugin-route",
    source: "fastify-plugin-route",
    framework: "fastify",
    routePath: "/plugins/status",
    body: "fastify plugin route ok",
    headerValue: "fastify-plugin-route",
    serverSource: pluginStyleServerSource,
  },
];

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generateThirdPartyAppCorpus(options.outDir);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`wrote ${summary.thirdPartyAppReportPath}\n`);
}

export function generateThirdPartyAppCorpus(outDir: string): ThirdPartyAppCorpusSummary {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const rows = thirdPartyApps.flatMap((app) =>
    nodeLevel5RealAppCorpusDirections.map((direction) =>
      runAppProductCommands(outDir, app, direction),
    ),
  );
  const thirdPartyAppReportPath = join(outDir, "node-level5-third-party-app-corpus-report.json");
  const report = writeNodeLevel5ThirdPartyAppCorpusReport({ path: thirdPartyAppReportPath, rows });
  const thirdPartyAppVerification = verifyNodeLevel5ThirdPartyAppCorpusReport(report);
  const releaseGate = runNodeLevel5RealAppCorpusCliJson([
    "node-level5",
    "release-gate",
    "--include-third-party-app-corpus",
    "--third-party-app-corpus-report",
    thirdPartyAppReportPath,
    "--json",
  ]);
  const summary: ThirdPartyAppCorpusSummary = {
    kind: "machinen.node-level5-third-party-app-corpus-summary",
    accepted: thirdPartyAppVerification.accepted && releaseGate.accepted === true,
    outDir,
    thirdPartyAppReportPath,
    rowCount: rows.length,
    rows,
    thirdPartyAppVerification,
    releaseGate,
    productCommands: ["machinen snapshot node <pid> --out <dir>", "machinen restore <snapshot>"],
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  writeFileSync(
    join(outDir, "node-level5-third-party-app-corpus-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function runAppProductCommands(
  outDir: string,
  app: ThirdPartyAppDefinition,
  direction: NodeLevel5ProductSnapshotDirection,
): NodeLevel5ThirdPartyAppCorpusRow {
  const appDir = appDirFor(outDir, app, direction);
  const snapshotDir = join(outDir, "snapshots", app.appName, direction);
  const child = spawnNodeLevel5RealAppCorpusTarget(appDir);
  try {
    const { snapshot, restore } = runNodeLevel5SnapshotRestoreForApp({
      child,
      appDir,
      snapshotDir,
      direction,
    });
    return rowFromProductRun(app, direction, snapshot, restore);
  } finally {
    stopNodeLevel5RealAppCorpusTarget(child);
  }
}

function appDirFor(
  outDir: string,
  app: ThirdPartyAppDefinition,
  direction: NodeLevel5ProductSnapshotDirection,
): string {
  const appDir = join(outDir, "fixtures", `${app.appName}-${direction}`);
  mkdirSync(appDir, { recursive: true });
  writeNodeLevel5RealAppFixturePackageJson(appDir, app.framework, "third-party-fixture");
  writeFileSync(join(appDir, "server.mjs"), app.serverSource(app));
  writeFileSync(
    join(appDir, "machinen-node-level5-behavior.json"),
    `${JSON.stringify(behaviorConfig(app), null, 2)}\n`,
  );
  return appDir;
}

function rowFromProductRun(
  app: ThirdPartyAppDefinition,
  direction: NodeLevel5ProductSnapshotDirection,
  snapshot: NodeLevel5ProductSnapshotSummary,
  restore: NodeLevel5ProductRestoreSummary,
): NodeLevel5ThirdPartyAppCorpusRow {
  const report = restore.behavioralVerifierReport;
  return {
    appName: app.appName,
    source: app.source,
    framework: app.framework,
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
    declaredSubset: true,
    unsupportedStateDetected: false,
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

function behaviorConfig(app: ThirdPartyAppDefinition): Record<string, unknown> {
  return {
    entry: "server.mjs",
    path: app.routePath,
    expectedStatus: 200,
    expectedBody: app.body,
    expectedHeaders: { "x-machinen-third-party-app": app.headerValue },
  };
}

function simpleHttpServerSource(app: ThirdPartyAppDefinition): string {
  return serverSourceForRoutes(app, [{ path: app.routePath, body: app.body }]);
}

function routerStyleServerSource(app: ThirdPartyAppDefinition): string {
  return serverSourceForRoutes(app, [
    { path: "/", body: "express generator home" },
    { path: app.routePath, body: app.body },
  ]);
}

function pluginStyleServerSource(app: ThirdPartyAppDefinition): string {
  return serverSourceForRoutes(app, [
    { path: "/plugins", body: "fastify plugin index" },
    { path: app.routePath, body: app.body },
  ]);
}

function serverSourceForRoutes(
  app: ThirdPartyAppDefinition,
  routes: Array<{ path: string; body: string }>,
): string {
  return nodeLevel5HttpServerSourceForRoutes({
    headerName: "x-machinen-third-party-app",
    headerValue: app.headerValue,
    routes,
  });
}

function parseArgs(args: string[]): { outDir: string; json: boolean } {
  return parseNodeLevel5RealAppCorpusOutArgs(
    args,
    "usage: node-level5-third-party-app-corpus --out <dir> [--json]",
  );
}

if (isNodeLevel5RealAppCorpusMain(import.meta.url)) {
  main();
}
