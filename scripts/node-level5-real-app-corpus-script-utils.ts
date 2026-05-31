import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  NodeLevel5ProductBehavioralVerifierReport,
  NodeLevel5ProductRestoreSummary,
  NodeLevel5ProductSnapshotDirection,
  NodeLevel5ProductSnapshotSummary,
} from "../packages/runtime/src/node-level5-product-snapshot.ts";
import type { NodeLevel5RealAppCorpusFramework } from "../packages/runtime/src/node-level5-real-app-corpus.ts";

export const nodeLevel5RealAppCorpusRepoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const nodeLevel5RealAppCorpusCliPath = join(
  nodeLevel5RealAppCorpusRepoRoot,
  "packages/cli/src/cli.ts",
);
export const nodeLevel5RealAppCorpusTsxLoaderPath = join(
  nodeLevel5RealAppCorpusRepoRoot,
  "node_modules/tsx/dist/loader.mjs",
);
export const nodeLevel5RealAppCorpusDirections: NodeLevel5ProductSnapshotDirection[] = [
  "arm64-to-amd64",
  "amd64-to-arm64",
];
export const nodeLevel5RealAppCorpusFrameworks: NodeLevel5RealAppCorpusFramework[] = [
  "express",
  "fastify",
];

export function writeNodeLevel5RealAppFixturePackageJson(
  appDir: string,
  framework: NodeLevel5RealAppCorpusFramework,
  suffix: string,
): void {
  const dependencies = framework === "express" ? { express: "^4.0.0" } : { fastify: "^4.0.0" };
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: `${framework}-${suffix}`, dependencies }, null, 2)}\n`,
  );
}

export function runNodeLevel5RealAppCorpusCliJson(
  args: string[],
  options: {
    cwd?: string;
    direction?: NodeLevel5ProductSnapshotDirection;
    expectedStatus?: number;
  } = {},
): Record<string, any> {
  const result = runNodeLevel5RealAppCorpusCli(args, options);
  assertNodeLevel5RealAppCorpusCliStatus(args, result, options.expectedStatus ?? 0);
  return JSON.parse(result.stdout || result.stderr);
}

function runNodeLevel5RealAppCorpusCli(
  args: string[],
  options: { cwd?: string; direction?: NodeLevel5ProductSnapshotDirection },
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    ["--import", nodeLevel5RealAppCorpusTsxLoaderPath, nodeLevel5RealAppCorpusCliPath, ...args],
    {
      cwd: options.cwd ?? nodeLevel5RealAppCorpusRepoRoot,
      env: nodeLevel5RealAppCorpusCliEnv(options.direction),
      encoding: "utf8",
    },
  );
}

function assertNodeLevel5RealAppCorpusCliStatus(
  args: string[],
  result: SpawnSyncReturns<string>,
  expectedStatus: number,
): void {
  if (result.status !== expectedStatus) {
    throw new Error(
      `CLI failed ${args.join(" ")}: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
}

function nodeLevel5RealAppCorpusCliEnv(
  direction: NodeLevel5ProductSnapshotDirection | undefined,
): NodeJS.ProcessEnv {
  return direction
    ? { ...process.env, MACHINEN_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION: direction }
    : { ...process.env };
}

export function runNodeLevel5SnapshotRestoreForApp(input: {
  child: ChildProcess;
  appDir: string;
  snapshotDir: string;
  direction: NodeLevel5ProductSnapshotDirection;
}): {
  snapshot: NodeLevel5ProductSnapshotSummary;
  restore: NodeLevel5ProductRestoreSummary;
} {
  const snapshot = runNodeLevel5RealAppCorpusCliJson(
    ["snapshot", "node", String(input.child.pid), "--out", input.snapshotDir, "--json"],
    { cwd: input.appDir, direction: input.direction },
  ) as NodeLevel5ProductSnapshotSummary;
  const restore = runNodeLevel5RealAppCorpusCliJson([
    "restore",
    input.snapshotDir,
    "--json",
  ]) as NodeLevel5ProductRestoreSummary;
  return { snapshot, restore };
}

export function selectedNodeLevel5BehavioralHeaders(
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

export function nodeLevel5HttpServerSourceForRoutes(input: {
  headerName: string;
  headerValue: string;
  routes: Array<{ path: string; body: string }>;
}): string {
  return `
import http from "node:http";
const port = Number(process.env.PORT ?? "0");
const routes = new Map(${JSON.stringify(input.routes.map((route) => [route.path, route.body]))});
const server = http.createServer((request, response) => {
  const body = routes.get(request.url ?? "");
  if (!body) {
    response.writeHead(404);
    response.end("not-found");
    return;
  }
  response.writeHead(200, { [${JSON.stringify(input.headerName)}]: ${JSON.stringify(input.headerValue)} });
  response.end(body);
});
server.listen(port, "127.0.0.1");
`;
}

export function spawnNodeLevel5RealAppCorpusTarget(cwd: string): ChildProcess {
  return spawn(process.execPath, ["server.mjs"], {
    cwd,
    env: { ...process.env, ...readNodeLevel5RealAppEnvFixture(cwd), PORT: "0" },
    stdio: "ignore",
  });
}

function readNodeLevel5RealAppEnvFixture(cwd: string): Record<string, string> {
  const path = join(cwd, "machinen-node-level5-env.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {};
}

export function stopNodeLevel5RealAppCorpusTarget(child: ChildProcess): void {
  child.kill("SIGTERM");
}

export function isNodeLevel5RealAppCorpusMain(metaUrl: string): boolean {
  return Boolean(
    process.argv[1] &&
    existsSync(process.argv[1]) &&
    resolve(process.argv[1]) === fileURLToPath(metaUrl),
  );
}

export function parseNodeLevel5RealAppCorpusOutArgs(
  args: string[],
  usage: string,
): { outDir: string; json: boolean } {
  const outFlag = args.indexOf("--out");
  const outDir = outFlag === -1 ? undefined : args[outFlag + 1];
  if (!outDir) {
    throw new Error(usage);
  }
  return { outDir: resolve(outDir), json: args.includes("--json") };
}
