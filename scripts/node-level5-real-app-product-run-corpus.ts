import { spawn, type ChildProcess } from "node:child_process";
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
  runNodeLevel5RealAppCorpusCliJson,
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
    return rowFromProductRun(framework, direction, snapshot, restore);
  } finally {
    stopTarget(child);
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
    actualHeaders: selectedHeaders(report),
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
  return `
import http from "node:http";
const port = Number(process.env.PORT ?? "0");
const route = ${JSON.stringify(input.route)};
const body = ${JSON.stringify(input.body)};
const server = http.createServer((request, response) => {
  if (request.url !== route) {
    response.writeHead(404);
    response.end("not-found");
    return;
  }
  response.writeHead(${input.status}, { "x-machinen-fixture": ${JSON.stringify(input.headerValue)} });
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
    "usage: node-level5-real-app-product-run-corpus --out <dir> [--json]",
  );
}

if (isNodeLevel5RealAppCorpusMain(import.meta.url)) {
  main();
}
