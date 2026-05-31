import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NodeLevel5ProductSnapshotDirection } from "../packages/runtime/src/node-level5-product-snapshot.ts";
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
