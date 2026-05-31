import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const directions: NodeLevel5ProductSnapshotDirection[] = ["arm64-to-amd64", "amd64-to-arm64"];
const frameworks: NodeLevel5RealAppCorpusFramework[] = ["express", "fastify"];

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
  const rows = frameworks.flatMap((framework) =>
    directions.map((direction) => runFixtureProductCommands(outDir, framework, direction)),
  );
  const corpusReportPath = join(outDir, "node-level5-real-app-corpus-report.json");
  const corpusReport = writeNodeLevel5RealAppCorpusReport({ path: corpusReportPath, rows });
  const corpusVerification = verifyNodeLevel5RealAppCorpusReport(corpusReport);
  const releaseGate = cliJson([
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
    const snapshot = cliJson(
      ["snapshot", "node", String(child.pid), "--out", snapshotDir, "--json"],
      { cwd: appDir, direction },
    ) as NodeLevel5ProductSnapshotSummary;
    const restore = cliJson(["restore", snapshotDir, "--json"]) as NodeLevel5ProductRestoreSummary;
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
    actualStatus: report.actualStatus ?? 0,
    expectedBody: report.expectedBody,
    actualBody: report.actualBody ?? "",
    expectedHeaders: report.expectedHeaders ?? {},
    actualHeaders: selectedHeaders(report),
    snapshotAccepted: snapshot.accepted,
    restoreAccepted: restore.accepted,
    behavioralVerifierPassed: restore.behavioralVerifierPassed,
    targetNativeNodeVerified: restore.targetNativeNodeVerified && report.targetNativeNodeVerified,
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

function fixtureAppDir(
  outDir: string,
  framework: NodeLevel5RealAppCorpusFramework,
  direction: NodeLevel5ProductSnapshotDirection,
): string {
  const appDir = join(outDir, "fixtures", `${framework}-${direction}`);
  mkdirSync(appDir, { recursive: true });
  writePackageJson(appDir, framework);
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

function writePackageJson(appDir: string, framework: NodeLevel5RealAppCorpusFramework): void {
  const dependencies = framework === "express" ? { express: "^4.0.0" } : { fastify: "^4.0.0" };
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: `${framework}-product-run-fixture`, dependencies }, null, 2)}\n`,
  );
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

function cliJson(
  args: string[],
  options: { cwd?: string; direction?: NodeLevel5ProductSnapshotDirection } = {},
): Record<string, any> {
  const env = { ...process.env };
  if (options.direction) {
    env.MACHINEN_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION = options.direction;
  }
  const result = spawnSync(process.execPath, ["--import", tsxLoaderPath, cliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `CLI failed ${args.join(" ")}: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function parseArgs(args: string[]): { outDir: string; json: boolean } {
  const outFlag = args.indexOf("--out");
  const outDir = outFlag === -1 ? undefined : args[outFlag + 1];
  if (!outDir) {
    throw new Error("usage: node-level5-real-app-product-run-corpus --out <dir> [--json]");
  }
  return { outDir: resolve(outDir), json: args.includes("--json") };
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
