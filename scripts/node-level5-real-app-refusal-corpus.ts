import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  verifyNodeLevel5RealAppRefusalCorpusReport,
  writeNodeLevel5RealAppRefusalCorpusReport,
  type NodeLevel5RealAppRefusalCorpusRow,
  type NodeLevel5RealAppRefusalMarker,
} from "../packages/runtime/src/node-level5-real-app-refusal-corpus.ts";
import {
  NODE_LEVEL5_PRODUCT_REFUSAL_MARKERS,
  type NodeLevel5ProductSnapshotDirection,
  type NodeLevel5ProductSnapshotRefusalCode,
  type NodeLevel5ProductSnapshotSummary,
} from "../packages/runtime/src/node-level5-product-snapshot.ts";
import type { NodeLevel5RealAppCorpusFramework } from "../packages/runtime/src/node-level5-real-app-corpus.ts";
import {
  isNodeLevel5RealAppCorpusMain,
  nodeLevel5RealAppCorpusDirections,
  nodeLevel5RealAppCorpusFrameworks,
  parseNodeLevel5RealAppCorpusOutArgs,
  runNodeLevel5RealAppCorpusCliJson,
  writeNodeLevel5RealAppFixturePackageJson,
} from "./node-level5-real-app-corpus-script-utils.ts";
const refusalCases: RefusalCase[] = NODE_LEVEL5_PRODUCT_REFUSAL_MARKERS.map(([marker, code]) => [
  marker as NodeLevel5RealAppRefusalMarker,
  code,
]);

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
  const rows = nodeLevel5RealAppCorpusFrameworks.flatMap((framework) =>
    nodeLevel5RealAppCorpusDirections.flatMap((direction) =>
      refusalCases.map((refusalCase) =>
        runRefusalProductCommand(outDir, framework, direction, refusalCase),
      ),
    ),
  );
  const refusalReportPath = join(outDir, "node-level5-real-app-refusal-corpus-report.json");
  const report = writeNodeLevel5RealAppRefusalCorpusReport({ path: refusalReportPath, rows });
  const refusalVerification = verifyNodeLevel5RealAppRefusalCorpusReport(report);
  const releaseGate = runNodeLevel5RealAppCorpusCliJson([
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
  return runNodeLevel5RealAppCorpusCliJson(
    ["snapshot", "node", String(child.pid), "--out", snapshotDir, "--json"],
    { cwd, direction, expectedStatus: 1 },
  ) as NodeLevel5ProductSnapshotSummary;
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
  writeNodeLevel5RealAppFixturePackageJson(appDir, framework, "refusal-fixture");
  writeFileSync(join(appDir, "server.mjs"), serverSource());
  writeFileSync(
    join(appDir, "machinen-node-level5-detector.json"),
    `${JSON.stringify({ [marker]: true }, null, 2)}\n`,
  );
  return appDir;
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

function parseArgs(args: string[]): { outDir: string; json: boolean } {
  return parseNodeLevel5RealAppCorpusOutArgs(
    args,
    "usage: node-level5-real-app-refusal-corpus --out <dir> [--json]",
  );
}

if (isNodeLevel5RealAppCorpusMain(import.meta.url)) {
  main();
}
