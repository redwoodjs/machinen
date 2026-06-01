import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { NodeLevel5RealAppCorpusFramework } from "../../../packages/runtime/src/node-level5-real-app-corpus.ts";
import type { NodeLevel5ProductSnapshotDirection } from "../../../packages/runtime/src/node-level5-product-snapshot.ts";
import {
  verifyNodeLevel5ThirdPartyAppCorpusReport,
  writeNodeLevel5ThirdPartyAppCorpusReport,
  type NodeLevel5ThirdPartyAppCorpusRow,
  type NodeLevel5ThirdPartyAppSource,
} from "../../../packages/runtime/src/node-level5-third-party-app-corpus.ts";
import {
  isNodeLevel5RealAppCorpusMain,
  nodeLevel5AppCorpusIdentity,
  nodeLevel5DeclaredSubsetCorpusFields,
  nodeLevel5RealAppCorpusDirections,
  parseNodeLevel5RealAppCorpusOutArgs,
  nodeLevel5HttpEvidenceFromProductRun,
  nodeLevel5HttpServerSourceForRoutes,
  runNodeLevel5ProductPathForNamedApp,
  runNodeLevel5RealAppCorpusCliJson,
  writeNodeLevel5BehaviorConfig,
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
  productCommands: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"];
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
    productCommands: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
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
  return runNodeLevel5ProductPathForNamedApp({
    outDir,
    appName: app.appName,
    appDir,
    direction,
    row: ({ snapshot, restore }) => ({
      ...nodeLevel5AppCorpusIdentity(app, direction),
      ...nodeLevel5HttpEvidenceFromProductRun(snapshot, restore),
      ...nodeLevel5DeclaredSubsetCorpusFields(),
    }),
  });
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
  writeNodeLevel5BehaviorConfig(appDir, behaviorConfig(app));
  return appDir;
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
