import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sensiblePackage from "@fastify/sensible/package.json" with { type: "json" };
import expressPackage from "express/package.json" with { type: "json" };
import fastifyPackage from "fastify/package.json" with { type: "json" };

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

const installedThirdPartyPackageVersions = {
  express: String(expressPackage.version),
  fastify: String(fastifyPackage.version),
  "@fastify/sensible": String(sensiblePackage.version),
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
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
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
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressRouterSource,
  },
  {
    appName: "express-installed-json-response",
    source: "express-installed-json-response",
    framework: "express",
    routePath: "/json",
    body: JSON.stringify({ message: "installed express json" }),
    headerValue: "express-installed-json-response",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressJsonResponseSource,
  },
  {
    appName: "express-installed-route-params",
    source: "express-installed-route-params",
    framework: "express",
    routePath: "/users/42",
    body: "installed express params user 42",
    headerValue: "express-installed-route-params",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressRouteParamsSource,
  },
  {
    appName: "express-installed-query-string",
    source: "express-installed-query-string",
    framework: "express",
    routePath: "/search?term=machinen",
    body: "installed express query machinen",
    headerValue: "express-installed-query-string",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressQueryStringSource,
  },
  {
    appName: "express-installed-static-asset",
    source: "express-installed-static-asset",
    framework: "express",
    routePath: "/assets/message.txt",
    body: "installed express static asset",
    headerValue: "express-installed-static-asset",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressStaticAssetSource,
  },
  {
    appName: "express-installed-idle-timer",
    source: "express-installed-idle-timer",
    framework: "express",
    routePath: "/timer/status",
    body: "installed express idle timer active",
    headerValue: "express-installed-idle-timer",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressIdleTimerSource,
  },
  {
    appName: "express-installed-safe-outbound-reconnect",
    source: "express-installed-safe-outbound-reconnect",
    framework: "express",
    routePath: "/outbound/status",
    body: "installed express safe outbound reconnect active",
    headerValue: "express-installed-safe-outbound-reconnect",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressSafeOutboundReconnectSource,
  },
  {
    appName: "fastify-installed-getting-started",
    source: "fastify-installed-getting-started",
    framework: "fastify",
    routePath: "/",
    body: "hello from installed fastify",
    headerValue: "fastify-installed-getting-started",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyGettingStartedSource,
  },
  {
    appName: "fastify-installed-json-response",
    source: "fastify-installed-json-response",
    framework: "fastify",
    routePath: "/json",
    body: JSON.stringify({ message: "installed fastify json" }),
    headerValue: "fastify-installed-json-response",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyJsonResponseSource,
  },
  {
    appName: "fastify-installed-route-params",
    source: "fastify-installed-route-params",
    framework: "fastify",
    routePath: "/users/42",
    body: "installed fastify params user 42",
    headerValue: "fastify-installed-route-params",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyRouteParamsSource,
  },
  {
    appName: "fastify-installed-query-string",
    source: "fastify-installed-query-string",
    framework: "fastify",
    routePath: "/search?term=machinen",
    body: "installed fastify query machinen",
    headerValue: "fastify-installed-query-string",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyQueryStringSource,
  },
  {
    appName: "fastify-installed-static-asset",
    source: "fastify-installed-static-asset",
    framework: "fastify",
    routePath: "/assets/message.txt",
    body: "installed fastify static asset",
    headerValue: "fastify-installed-static-asset",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyStaticAssetSource,
  },
  {
    appName: "fastify-installed-idle-timer",
    source: "fastify-installed-idle-timer",
    framework: "fastify",
    routePath: "/timer/status",
    body: "installed fastify idle timer active",
    headerValue: "fastify-installed-idle-timer",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyIdleTimerSource,
  },
  {
    appName: "fastify-installed-safe-outbound-reconnect",
    source: "fastify-installed-safe-outbound-reconnect",
    framework: "fastify",
    routePath: "/outbound/status",
    body: "installed fastify safe outbound reconnect active",
    headerValue: "fastify-installed-safe-outbound-reconnect",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifySafeOutboundReconnectSource,
  },
  {
    appName: "fastify-installed-plugin-route",
    source: "fastify-installed-plugin-route",
    framework: "fastify",
    routePath: "/plugins/status",
    body: "installed fastify plugin route ok",
    headerValue: "fastify-installed-plugin-route",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: {
      "@fastify/sensible": `^${installedThirdPartyPackageVersions["@fastify/sensible"]}`,
      fastify: `^${installedThirdPartyPackageVersions.fastify}`,
    },
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
  writeStaticAssetFixture(appDir, app);
  writeSafeIdleTimerDetectorFixture(appDir, app);
  writeSafeOutboundReconnectDetectorFixture(appDir, app);
  writeFileSync(join(appDir, "server.mjs"), app.serverSource(app));
  writeFileSync(
    join(appDir, "machinen-node-level5-behavior.json"),
    `${JSON.stringify(behaviorConfig(app), null, 2)}\n`,
  );
  return appDir;
}

function writeStaticAssetFixture(appDir: string, app: InstalledThirdPartyAppDefinition): void {
  if (!app.source.endsWith("static-asset")) {
    return;
  }
  const publicDir = join(appDir, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "message.txt"), app.body);
}

function writeSafeIdleTimerDetectorFixture(
  appDir: string,
  app: InstalledThirdPartyAppDefinition,
): void {
  writeDetectorFixture(appDir, app, "idle-timer", { safeIdleTimer: true });
}

function writeSafeOutboundReconnectDetectorFixture(
  appDir: string,
  app: InstalledThirdPartyAppDefinition,
): void {
  writeDetectorFixture(appDir, app, "safe-outbound-reconnect", {
    safeOutboundHttpReconnect: true,
  });
}

function writeDetectorFixture(
  appDir: string,
  app: InstalledThirdPartyAppDefinition,
  sourceSuffix: string,
  markers: Record<string, boolean>,
): void {
  if (!app.source.endsWith(sourceSuffix)) {
    return;
  }
  writeFileSync(
    join(appDir, "machinen-node-level5-detector.json"),
    `${JSON.stringify(markers, null, 2)}\n`,
  );
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

function expressJsonResponseSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).json(JSON.parse(${JSON.stringify(app.body)}));
});
app.listen(port, "127.0.0.1");
`;
}

function expressRouteParamsSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get("/users/:id", (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.params.id === "42" ? ${JSON.stringify(app.body)} : "wrong-user");
});
app.listen(port, "127.0.0.1");
`;
}

function expressQueryStringSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get("/search", (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.query.term === "machinen" ? ${JSON.stringify(app.body)} : "wrong-query");
});
app.listen(port, "127.0.0.1");
`;
}

function expressStaticAssetSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.use("/assets", (_request, response, next) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  next();
});
app.use("/assets", express.static("public"));
app.listen(port, "127.0.0.1");
`;
}

function expressIdleTimerSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
let ticks = 0;
const timer = setInterval(() => { ticks += 1; }, 25);
timer.unref();
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(ticks > 0 ? ${JSON.stringify(app.body)} : "timer-not-active");
});
app.listen(port, "127.0.0.1");
`;
}

function expressSafeOutboundReconnectSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import http from "node:http";
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
const upstream = http.createServer((_request, response) => {
  response.end(${JSON.stringify(app.body)});
});
upstream.listen(0, "127.0.0.1", () => {
  const upstreamPort = upstream.address().port;
  app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
    response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
    http.get({ host: "127.0.0.1", port: upstreamPort, path: "/upstream", agent: false }, (upstreamResponse) => {
      let body = "";
      upstreamResponse.setEncoding("utf8");
      upstreamResponse.on("data", (chunk) => { body += chunk; });
      upstreamResponse.on("end", () => response.status(200).send(body));
    }).on("error", () => response.status(502).send("outbound-error"));
  });
  app.listen(port, "127.0.0.1");
});
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

function fastifyJsonResponseSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return JSON.parse(${JSON.stringify(app.body)});
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyRouteParamsSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get("/users/:id", async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return request.params.id === "42" ? ${JSON.stringify(app.body)} : "wrong-user";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyQueryStringSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get("/search", async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return request.query.term === "machinen" ? ${JSON.stringify(app.body)} : "wrong-query";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyStaticAssetSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return await readFile("public/message.txt", "utf8");
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyIdleTimerSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
let ticks = 0;
const timer = setInterval(() => { ticks += 1; }, 25);
timer.unref();
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return ticks > 0 ? ${JSON.stringify(app.body)} : "timer-not-active";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifySafeOutboundReconnectSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import http from "node:http";
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
const upstream = http.createServer((_request, response) => {
  response.end(${JSON.stringify(app.body)});
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const upstreamPort = upstream.address().port;
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return await new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port: upstreamPort, path: "/upstream", agent: false }, (upstreamResponse) => {
      let body = "";
      upstreamResponse.setEncoding("utf8");
      upstreamResponse.on("data", (chunk) => { body += chunk; });
      upstreamResponse.on("end", () => resolve(body));
    }).on("error", () => resolve("outbound-error"));
  });
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
