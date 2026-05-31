import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { NodeLevel5RealAppCorpusFramework } from "../packages/runtime/src/node-level5-real-app-corpus.ts";
import type {
  NodeLevel5ProductBehavioralVerifierReport,
  NodeLevel5ProductRestoreSummary,
  NodeLevel5ProductSnapshotDirection,
  NodeLevel5ProductSnapshotSummary,
} from "../packages/runtime/src/node-level5-product-snapshot.ts";
import {
  verifyNodeLevel5InstalledThirdPartyAppCorpusReport,
  writeNodeLevel5InstalledThirdPartyAppCorpusReport,
  type NodeLevel5InstalledThirdPartyAppCorpusRow,
  type NodeLevel5InstalledThirdPartyAppSource,
} from "../packages/runtime/src/node-level5-installed-third-party-app-corpus.ts";
import {
  isNodeLevel5RealAppCorpusMain,
  nodeLevel5RealAppCorpusDirections,
  nodeLevel5RealAppCorpusRepoRoot,
  parseNodeLevel5RealAppCorpusOutArgs,
  runNodeLevel5RealAppCorpusCliJson,
  runNodeLevel5SnapshotRestoreForApp,
  selectedNodeLevel5BehavioralHeaders,
  spawnNodeLevel5RealAppCorpusTarget,
  stopNodeLevel5RealAppCorpusTarget,
} from "./node-level5-real-app-corpus-script-utils.ts";

type InstalledThirdPartyAppDefinition = {
  appName: string;
  source: NodeLevel5InstalledThirdPartyAppSource;
  framework: NodeLevel5RealAppCorpusFramework;
  routePath: string;
  body: string;
  headerValue: string;
  installedPackage: "express" | "fastify";
  installedPackageVersion: string;
  dependencies: Record<string, string>;
  serverSource: (input: InstalledThirdPartyAppDefinition) => string;
};

type InstalledThirdPartyAppCorpusSummary = {
  kind: "machinen.node-level5-installed-third-party-app-corpus-summary";
  accepted: boolean;
  outDir: string;
  installedThirdPartyAppReportPath: string;
  rowCount: number;
  rows: NodeLevel5InstalledThirdPartyAppCorpusRow[];
  installedThirdPartyAppVerification: ReturnType<
    typeof verifyNodeLevel5InstalledThirdPartyAppCorpusReport
  >;
  releaseGate: Record<string, any>;
  productCommands: ["machinen snapshot node <pid> --out <dir>", "machinen restore <snapshot>"];
  harnessProof: true;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

const installedThirdPartyApps: InstalledThirdPartyAppDefinition[] = [
  {
    appName: "express-installed-hello-world",
    source: "express-installed-hello-world",
    framework: "express",
    routePath: "/",
    body: "hello from installed express",
    headerValue: "express-installed-hello-world",
    installedPackage: "express",
    installedPackageVersion: "5.2.1",
    dependencies: { express: "^5.2.1" },
    serverSource: expressHelloWorldSource,
  },
  {
    appName: "express-installed-router",
    source: "express-installed-router",
    framework: "express",
    routePath: "/users/42",
    body: "installed express router user 42",
    headerValue: "express-installed-router",
    installedPackage: "express",
    installedPackageVersion: "5.2.1",
    dependencies: { express: "^5.2.1" },
    serverSource: expressRouterSource,
  },
  {
    appName: "fastify-installed-getting-started",
    source: "fastify-installed-getting-started",
    framework: "fastify",
    routePath: "/",
    body: "hello from installed fastify",
    headerValue: "fastify-installed-getting-started",
    installedPackage: "fastify",
    installedPackageVersion: "5.8.5",
    dependencies: { fastify: "^5.8.5" },
    serverSource: fastifyGettingStartedSource,
  },
  {
    appName: "fastify-installed-plugin-route",
    source: "fastify-installed-plugin-route",
    framework: "fastify",
    routePath: "/plugins/status",
    body: "installed fastify plugin route ok",
    headerValue: "fastify-installed-plugin-route",
    installedPackage: "fastify",
    installedPackageVersion: "5.8.5",
    dependencies: { "@fastify/sensible": "^6.0.4", fastify: "^5.8.5" },
    serverSource: fastifyPluginRouteSource,
  },
];

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generateInstalledThirdPartyAppCorpus(options.outDir);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`wrote ${summary.installedThirdPartyAppReportPath}\n`);
}

export function generateInstalledThirdPartyAppCorpus(
  outDir: string,
): InstalledThirdPartyAppCorpusSummary {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const rows = installedThirdPartyApps.flatMap((app) =>
    nodeLevel5RealAppCorpusDirections.map((direction) =>
      runAppProductCommands(outDir, app, direction),
    ),
  );
  const installedThirdPartyAppReportPath = join(
    outDir,
    "node-level5-installed-third-party-app-corpus-report.json",
  );
  const report = writeNodeLevel5InstalledThirdPartyAppCorpusReport({
    path: installedThirdPartyAppReportPath,
    rows,
  });
  const installedThirdPartyAppVerification =
    verifyNodeLevel5InstalledThirdPartyAppCorpusReport(report);
  const releaseGate = runNodeLevel5RealAppCorpusCliJson([
    "node-level5",
    "release-gate",
    "--include-installed-third-party-app-corpus",
    "--installed-third-party-app-corpus-report",
    installedThirdPartyAppReportPath,
    "--json",
  ]);
  const summary: InstalledThirdPartyAppCorpusSummary = {
    kind: "machinen.node-level5-installed-third-party-app-corpus-summary",
    accepted: installedThirdPartyAppVerification.accepted && releaseGate.accepted === true,
    outDir,
    installedThirdPartyAppReportPath,
    rowCount: rows.length,
    rows,
    installedThirdPartyAppVerification,
    releaseGate,
    productCommands: ["machinen snapshot node <pid> --out <dir>", "machinen restore <snapshot>"],
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  writeFileSync(
    join(outDir, "node-level5-installed-third-party-app-corpus-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function runAppProductCommands(
  outDir: string,
  app: InstalledThirdPartyAppDefinition,
  direction: NodeLevel5ProductSnapshotDirection,
): NodeLevel5InstalledThirdPartyAppCorpusRow {
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
  app: InstalledThirdPartyAppDefinition,
  direction: NodeLevel5ProductSnapshotDirection,
): string {
  const appDir = join(outDir, "fixtures", `${app.appName}-${direction}`);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: app.appName, type: "module", dependencies: app.dependencies }, null, 2)}\n`,
  );
  linkInstalledNodeModules(appDir);
  writeFileSync(join(appDir, "server.mjs"), app.serverSource(app));
  writeFileSync(
    join(appDir, "machinen-node-level5-behavior.json"),
    `${JSON.stringify(behaviorConfig(app), null, 2)}\n`,
  );
  return appDir;
}

function linkInstalledNodeModules(appDir: string): void {
  const nodeModules = join(appDir, "node_modules");
  if (!existsSync(nodeModules)) {
    symlinkSync(join(nodeLevel5RealAppCorpusRepoRoot, "node_modules"), nodeModules, "dir");
  }
}

function rowFromProductRun(
  app: InstalledThirdPartyAppDefinition,
  direction: NodeLevel5ProductSnapshotDirection,
  snapshot: NodeLevel5ProductSnapshotSummary,
  restore: NodeLevel5ProductRestoreSummary,
): NodeLevel5InstalledThirdPartyAppCorpusRow {
  const report = restore.behavioralVerifierReport;
  return {
    appName: app.appName,
    source: app.source,
    framework: app.framework,
    direction,
    installedPackage: app.installedPackage,
    installedPackageVersion: app.installedPackageVersion,
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

function behaviorConfig(app: InstalledThirdPartyAppDefinition): Record<string, unknown> {
  return {
    entry: "server.mjs",
    path: app.routePath,
    expectedStatus: 200,
    expectedBody: app.body,
    expectedHeaders: { "x-machinen-installed-third-party-app": app.headerValue },
  };
}

function expressHelloWorldSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(${JSON.stringify(app.body)});
});
app.listen(port, "127.0.0.1");
`;
}

function expressRouterSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const router = express.Router();
const port = Number(process.env.PORT ?? "0");
router.get("/42", (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(${JSON.stringify(app.body)});
});
app.get("/", (_request, response) => response.status(200).send("installed express home"));
app.use("/users", router);
app.listen(port, "127.0.0.1");
`;
}

function fastifyGettingStartedSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return ${JSON.stringify(app.body)};
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyPluginRouteSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
import sensible from "@fastify/sensible";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
await server.register(sensible);
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return ${JSON.stringify(app.body)};
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function parseArgs(args: string[]): { outDir: string; json: boolean } {
  return parseNodeLevel5RealAppCorpusOutArgs(
    args,
    "usage: node-level5-installed-third-party-app-corpus --out <dir> [--json]",
  );
}

if (isNodeLevel5RealAppCorpusMain(import.meta.url)) {
  main();
}
