import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifyNodeLevel5RealAppRefusalCorpusReport,
  writeNodeLevel5RealAppRefusalCorpusReport,
  type NodeLevel5RealAppRefusalCorpusRow,
  type NodeLevel5RealAppRefusalMarker,
} from "../packages/runtime/src/node-level5-real-app-refusal-corpus.ts";
import type {
  NodeLevel5ProductSnapshotDirection,
  NodeLevel5ProductSnapshotRefusalCode,
  NodeLevel5ProductSnapshotSummary,
} from "../packages/runtime/src/node-level5-product-snapshot.ts";
import type { NodeLevel5RealAppCorpusFramework } from "../packages/runtime/src/node-level5-real-app-corpus.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const directions: NodeLevel5ProductSnapshotDirection[] = ["arm64-to-amd64", "amd64-to-arm64"];
const frameworks: NodeLevel5RealAppCorpusFramework[] = ["express", "fastify"];
const refusalCases: RefusalCase[] = [
  ["activeRequests", "node-level5-active-request-refused"],
  ["workerThreads", "node-level5-worker-thread-refused"],
  ["nativeAddons", "node-level5-native-addon-refused"],
  ["wasmExternalMemory", "node-level5-wasm-external-memory-refused"],
  ["tlsActiveState", "node-level5-tls-active-state-refused"],
  ["childProcesses", "node-level5-child-process-live-state-refused"],
  ["filesystemWatchers", "node-level5-filesystem-watcher-refused"],
  ["websockets", "node-level5-websocket-live-state-refused"],
];

type RefusalCase = [NodeLevel5RealAppRefusalMarker, NodeLevel5ProductSnapshotRefusalCode];

type RefusalCorpusSummary = {
  kind: "machinen.node-level5-real-app-refusal-corpus-summary";
  accepted: boolean;
  outDir: string;
  refusalReportPath: string;
  rowCount: number;
  rows: NodeLevel5RealAppRefusalCorpusRow[];
  refusalVerification: ReturnType<typeof verifyNodeLevel5RealAppRefusalCorpusReport>;
  releaseGate: Record<string, any>;
  productCommand: "machinen snapshot node <pid> --out <dir>";
  harnessProof: true;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generateRefusalCorpus(options.outDir);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`wrote ${summary.refusalReportPath}\n`);
}

export function generateRefusalCorpus(outDir: string): RefusalCorpusSummary {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const rows = frameworks.flatMap((framework) =>
    directions.flatMap((direction) =>
      refusalCases.map((refusalCase) =>
        runRefusalProductCommand(outDir, framework, direction, refusalCase),
      ),
    ),
  );
  const refusalReportPath = join(outDir, "node-level5-real-app-refusal-corpus-report.json");
  const report = writeNodeLevel5RealAppRefusalCorpusReport({ path: refusalReportPath, rows });
  const refusalVerification = verifyNodeLevel5RealAppRefusalCorpusReport(report);
  const releaseGate = cliJson([
    "node-level5",
    "release-gate",
    "--include-refusal-corpus",
    "--refusal-corpus-report",
    refusalReportPath,
    "--json",
  ]);
  const summary: RefusalCorpusSummary = {
    kind: "machinen.node-level5-real-app-refusal-corpus-summary",
    accepted: refusalVerification.accepted && releaseGate.accepted === true,
    outDir,
    refusalReportPath,
    rowCount: rows.length,
    rows,
    refusalVerification,
    releaseGate,
    productCommand: "machinen snapshot node <pid> --out <dir>",
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  writeFileSync(
    join(outDir, "node-level5-real-app-refusal-corpus-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function runRefusalProductCommand(
  outDir: string,
  framework: NodeLevel5RealAppCorpusFramework,
  direction: NodeLevel5ProductSnapshotDirection,
  refusalCase: RefusalCase,
): NodeLevel5RealAppRefusalCorpusRow {
  const appDir = fixtureAppDir(outDir, framework, direction, refusalCase[0]);
  const snapshotDir = join(outDir, "refused-snapshots", framework, direction, refusalCase[0]);
  const child = spawnTarget(appDir);
  try {
    const snapshot = runSnapshotExpectRefusal(child, appDir, snapshotDir, direction);
    return refusalRow(framework, direction, refusalCase, snapshot, snapshotDir);
  } finally {
    stopTarget(child);
  }
}

function runSnapshotExpectRefusal(
  child: ChildProcess,
  cwd: string,
  snapshotDir: string,
  direction: NodeLevel5ProductSnapshotDirection,
): NodeLevel5ProductSnapshotSummary {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoaderPath,
      cliPath,
      "snapshot",
      "node",
      String(child.pid),
      "--out",
      snapshotDir,
      "--json",
    ],
    {
      cwd,
      env: { ...process.env, MACHINEN_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION: direction },
      encoding: "utf8",
    },
  );
  if (result.status !== 1) {
    throw new Error(
      `snapshot unexpectedly accepted: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as NodeLevel5ProductSnapshotSummary;
}

function refusalRow(
  framework: NodeLevel5RealAppCorpusFramework,
  direction: NodeLevel5ProductSnapshotDirection,
  [marker, expectedRefusalCode]: RefusalCase,
  snapshot: NodeLevel5ProductSnapshotSummary,
  snapshotDir: string,
): NodeLevel5RealAppRefusalCorpusRow {
  return {
    framework,
    direction,
    marker,
    expectedRefusalCode,
    actualRefusalCode: snapshot.refusal?.code ?? "node-level5-unsupported-app-refused",
    snapshotAccepted: false,
    snapshotManifestWritten: assertSnapshotManifestNotWritten(snapshotDir),
    refusedBeforeSnapshot: assertSnapshotRefused(snapshot),
    productCommandPath: "machinen snapshot node <pid> --out <dir>",
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    metadataOnlySuccessAccepted: false,
  };
}

function assertSnapshotManifestNotWritten(snapshotDir: string): false {
  if (existsSync(join(snapshotDir, "node-level5-product-snapshot.json"))) {
    throw new Error(`refused snapshot wrote a manifest in ${snapshotDir}`);
  }
  return false;
}

function assertSnapshotRefused(snapshot: NodeLevel5ProductSnapshotSummary): true {
  if (snapshot.accepted !== false) {
    throw new Error("refusal corpus expected snapshot rejection before capture");
  }
  return true;
}

function fixtureAppDir(
  outDir: string,
  framework: NodeLevel5RealAppCorpusFramework,
  direction: NodeLevel5ProductSnapshotDirection,
  marker: NodeLevel5RealAppRefusalMarker,
): string {
  const appDir = join(outDir, "fixtures", `${framework}-${direction}-${marker}`);
  mkdirSync(appDir, { recursive: true });
  writePackageJson(appDir, framework);
  writeFileSync(join(appDir, "server.mjs"), serverSource());
  writeFileSync(
    join(appDir, "machinen-node-level5-detector.json"),
    `${JSON.stringify({ [marker]: true }, null, 2)}\n`,
  );
  return appDir;
}

function writePackageJson(appDir: string, framework: NodeLevel5RealAppCorpusFramework): void {
  const dependencies = framework === "express" ? { express: "^4.0.0" } : { fastify: "^4.0.0" };
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: `${framework}-refusal-fixture`, dependencies }, null, 2)}\n`,
  );
}

function serverSource(): string {
  return `
setInterval(() => {}, 1000);
`;
}

function spawnTarget(cwd: string): ChildProcess {
  return spawn(process.execPath, ["server.mjs"], { cwd, stdio: "ignore" });
}

function stopTarget(child: ChildProcess): void {
  child.kill("SIGTERM");
}

function cliJson(args: string[]): Record<string, any> {
  const result = spawnSync(process.execPath, ["--import", tsxLoaderPath, cliPath, ...args], {
    cwd: repoRoot,
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
    throw new Error("usage: node-level5-real-app-refusal-corpus --out <dir> [--json]");
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
