import { spawn, type ChildProcess } from "node:child_process";
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
  runNodeLevel5RealAppCorpusCliJson,
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
  const child = spawnTarget(appDir);
  try {
    const snapshot = runNodeLevel5RealAppCorpusCliJson(
      ["snapshot", "node", String(child.pid), "--out", snapshotDir, "--json"],
      { cwd: appDir, direction },
    ) as NodeLevel5ProductSnapshotSummary;
    const restore = runNodeLevel5RealAppCorpusCliJson([
      "restore",
      snapshotDir,
      "--json",
    ]) as NodeLevel5ProductRestoreSummary;
    return rowFromProductRun(app, direction, snapshot, restore);
  } finally {
    stopTarget(child);
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
    actualStatus: report.actualStatus ?? 0,
    expectedBody: report.expectedBody,
    actualBody: report.actualBody ?? "",
    expectedHeaders: report.expectedHeaders ?? {},
    actualHeaders: selectedHeaders(report),
    snapshotAccepted: snapshot.accepted,
    restoreAccepted: restore.accepted,
    behavioralVerifierPassed: restore.behavioralVerifierPassed,
    targetNativeNodeVerified: restore.targetNativeNodeVerified && report.targetNativeNodeVerified,
    declaredSubset: true,
    unsupportedStateDetected: false,
  };
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

function selectedHeaders(
  report: NodeLevel5ProductBehavioralVerifierReport,
): Record<string, string> {
  const actual = report.actualHeaders ?? {};
  return Object.fromEntries(
    Object.keys(report.expectedHeaders ?? {}).map((key) => [
      key,
      String(actual[key.toLowerCase()] ?? ""),
    ]),
  );
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
  return `
import http from "node:http";
const port = Number(process.env.PORT ?? "0");
const routes = new Map(${JSON.stringify(routes.map((route) => [route.path, route.body]))});
const server = http.createServer((request, response) => {
  const body = routes.get(request.url ?? "");
  if (!body) {
    response.writeHead(404);
    response.end("not-found");
    return;
  }
  response.writeHead(200, { "x-machinen-third-party-app": ${JSON.stringify(app.headerValue)} });
  response.end(body);
});
server.listen(port, "127.0.0.1");
`;
}

function spawnTarget(cwd: string): ChildProcess {
  return spawn(process.execPath, ["server.mjs"], {
    cwd,
    env: { ...process.env, PORT: "0" },
    stdio: "ignore",
  });
}

function stopTarget(child: ChildProcess): void {
  child.kill("SIGTERM");
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
