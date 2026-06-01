import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildNodeLevel5AppSupportMatrix,
  type NodeLevel5AppSupportMatrixRow,
} from "../../../packages/runtime/src/node-level5-app-support-matrix.ts";

const directions = ["arm64-to-amd64", "amd64-to-arm64"] as const;
type Direction = (typeof directions)[number];

type SupportedDirectionCoverage = {
  rowId: string;
  direction: Direction;
  status: "missing" | "covered";
  requiredFiles: Record<string, string>;
  missingFiles: string[];
};

type RefusedDirectionCoverage = {
  rowId: string;
  direction: Direction;
  status: "covered" | "missing";
  source: "real-app-refusal-corpus" | "generic-vm-refusal-artifacts";
  marker: string;
  artifact: string;
  expectedRefusalCode?: string;
  missingReason?: string;
};

type NotProvenRow = {
  rowId: string;
  framework: string;
  appName: string;
  reason: string;
  requiredResolution: "support-with-retained-e2e" | "refuse-with-retained-artifact";
};

type NodeClaimRowCoverageReport = {
  kind: "machinen.node-claim-row-coverage-report";
  version: 1;
  generatedAt: string;
  accepted: true;
  claimAllowed: false;
  publicClaim: {
    productSupport: 0;
    broadSupport: 0;
    arbitraryProcessCrossArchRestore: 0;
  };
  rowCounts: {
    supportedRows: number;
    refusedRows: number;
    notProvenRows: number;
  };
  directionRequirementCounts: {
    supportedRequired: number;
    supportedCovered: number;
    supportedMissing: number;
    refusedRequired: number;
    refusedCovered: number;
    refusedMissing: number;
  };
  supportedCoverage: SupportedDirectionCoverage[];
  refusedCoverage: RefusedDirectionCoverage[];
  notProvenBlockers: NotProvenRow[];
  retainedSources: Array<{ id: string; path: string; accepted: boolean }>;
  nextRequiredFor100: string[];
};

type RealAppRefusalReport = {
  accepted?: boolean;
  rows?: Array<{
    framework: string;
    direction: string;
    marker: string;
    expectedRefusalCode: string;
    actualRefusalCode: string;
    snapshotAccepted: boolean;
    snapshotManifestWritten: boolean;
    refusedBeforeSnapshot: boolean;
  }>;
};

type GenericVmRefusalReport = {
  accepted?: boolean;
  refusalArtifactFiles?: Array<{
    rowId: string;
    framework: string;
    marker: string;
    direction: string;
    expectedRefusalCode: string;
    path: string;
    required: boolean;
  }>;
};

const markerBySuffix = new Map([
  ["active-requests", "activeRequests"],
  ["worker-threads", "workerThreads"],
  ["native-addons", "nativeAddons"],
  ["wasm-external-memory", "wasmExternalMemory"],
  ["tls-active-state", "tlsActiveState"],
  ["child-processes", "childProcesses"],
  ["filesystem-watchers", "filesystemWatchers"],
  ["websockets", "websockets"],
  ["db-connections", "dbConnections"],
  ["redis-queue-connections", "redisQueueConnections"],
  ["outbound-http-sockets", "outboundHttpSockets"],
  ["http2-sessions", "http2Sessions"],
  ["server-sent-events", "serverSentEvents"],
  ["open-writable-files", "openWritableFiles"],
  ["timers-intervals", "timersIntervals"],
  ["cluster-mode", "clusterMode"],
]);

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildNodeClaimRowCoverageReport(options.root);
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `node claim row coverage: supported ${report.directionRequirementCounts.supportedCovered}/${report.directionRequirementCounts.supportedRequired}, refused ${report.directionRequirementCounts.refusedCovered}/${report.directionRequirementCounts.refusedRequired}, not-proven ${report.rowCounts.notProvenRows}\n`,
    );
  }
}

export function buildNodeClaimRowCoverageReport(root: string): NodeClaimRowCoverageReport {
  const resolvedRoot = resolve(root);
  const matrix = buildNodeLevel5AppSupportMatrix();
  const supportedRows = matrix.rows.filter((row) => row.status === "supported");
  const refusedRows = matrix.rows.filter((row) => row.status === "refused");
  const notProvenRows = matrix.rows.filter((row) => row.status === "not-proven");
  const realAppReportPath = join(
    resolvedRoot,
    "claim-evidence-index/retained/refusals/real-app/node-level5-real-app-refusal-corpus-report.json",
  );
  const genericVmReportPath = join(
    resolvedRoot,
    "claim-evidence-index/retained/refusals/generic-vm/node-level5-generic-vm-refusal-artifacts-report.json",
  );
  const realAppReport = readJson(realAppReportPath) as RealAppRefusalReport | undefined;
  const genericVmReport = readJson(genericVmReportPath) as GenericVmRefusalReport | undefined;
  const supportedCoverage = supportedRows.flatMap((row) =>
    directions.map((direction) => supportedDirectionCoverage(resolvedRoot, row, direction)),
  );
  const refusedCoverage = refusedRows.flatMap((row) =>
    directions.map((direction) =>
      refusedDirectionCoverage(resolvedRoot, row, direction, realAppReport, genericVmReport),
    ),
  );
  const supportedCovered = supportedCoverage.filter((row) => row.status === "covered").length;
  const refusedCovered = refusedCoverage.filter((row) => row.status === "covered").length;
  return {
    kind: "machinen.node-claim-row-coverage-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted: true,
    claimAllowed: false,
    publicClaim: {
      productSupport: 0,
      broadSupport: 0,
      arbitraryProcessCrossArchRestore: 0,
    },
    rowCounts: {
      supportedRows: supportedRows.length,
      refusedRows: refusedRows.length,
      notProvenRows: notProvenRows.length,
    },
    directionRequirementCounts: {
      supportedRequired: supportedCoverage.length,
      supportedCovered,
      supportedMissing: supportedCoverage.length - supportedCovered,
      refusedRequired: refusedCoverage.length,
      refusedCovered,
      refusedMissing: refusedCoverage.length - refusedCovered,
    },
    supportedCoverage,
    refusedCoverage,
    notProvenBlockers: notProvenRows.map(notProvenBlocker),
    retainedSources: [
      {
        id: "real-app-refusal-corpus",
        path: displayPath(realAppReportPath),
        accepted: realAppReport?.accepted === true,
      },
      {
        id: "generic-vm-refusal-artifacts",
        path: displayPath(genericVmReportPath),
        accepted: genericVmReport?.accepted === true,
      },
    ],
    nextRequiredFor100: [
      "Populate retained row-evidence/supported/<row-id>/<direction>/ for every supported row and both directions.",
      "Resolve every not-proven row as either supported with retained E2E artifacts or refused with retained refusal artifacts.",
      "Keep refused row coverage at 100% and link each refused matrix row to retained refusal reports/artifacts.",
      "Only allow a public claim raise when supportedMissing=0, refusedMissing=0, and notProvenRows=0.",
    ],
  };
}

function supportedDirectionCoverage(
  root: string,
  row: NodeLevel5AppSupportMatrixRow,
  direction: Direction,
): SupportedDirectionCoverage {
  const requiredFiles = supportedRequiredFiles(root, row.id, direction);
  const missingFiles = Object.values(requiredFiles).filter((path) => !existsSync(path));
  return {
    rowId: row.id,
    direction,
    status: missingFiles.length === 0 ? "covered" : "missing",
    requiredFiles: displayRecord(requiredFiles),
    missingFiles: missingFiles.map(displayPath),
  };
}

function supportedRequiredFiles(
  root: string,
  rowId: string,
  direction: Direction,
): Record<string, string> {
  const base = join(root, "claim-evidence-index/retained/row-evidence/supported", rowId, direction);
  return {
    sourceProductCommand: join(base, "source/product-command.txt"),
    sourceSnapshotSummary: join(base, "source/snapshot.json"),
    sourceManifest: join(base, "source/portable-node.json"),
    sourceArtifact: join(base, "source/portable-node-app.tar.gz"),
    targetProductCommand: join(base, "target/product-command.txt"),
    targetRestoreSummary: join(base, "target/restore.json"),
    targetBehavior: join(base, "target/target-http-body.txt"),
    targetVerifier: join(base, "target/verifier.json"),
  };
}

function refusedDirectionCoverage(
  root: string,
  row: NodeLevel5AppSupportMatrixRow,
  direction: Direction,
  realAppReport: RealAppRefusalReport | undefined,
  genericVmReport: GenericVmRefusalReport | undefined,
): RefusedDirectionCoverage {
  const marker = markerForRowId(row.id);
  const generic = row.id.includes("generic-vm");
  if (!marker) {
    return missingRefusal(row, direction, generic, "could not derive refusal marker from row id");
  }
  if (generic) {
    const file = genericVmReport?.refusalArtifactFiles?.find(
      (candidate) =>
        candidate.framework === row.framework &&
        candidate.marker === marker &&
        candidate.direction === direction &&
        candidate.required === true,
    );
    if (!file || genericVmReport?.accepted !== true) {
      return missingRefusal(row, direction, generic, "generic VM refusal artifact missing");
    }
    return {
      rowId: row.id,
      direction,
      status: "covered",
      source: "generic-vm-refusal-artifacts",
      marker,
      artifact: displayPath(
        join(root, "claim-evidence-index/retained/refusals/generic-vm", file.path),
      ),
      expectedRefusalCode: file.expectedRefusalCode,
    };
  }
  const refusal = realAppReport?.rows?.find(
    (candidate) =>
      candidate.framework === row.framework &&
      candidate.marker === marker &&
      candidate.direction === direction &&
      candidate.actualRefusalCode === candidate.expectedRefusalCode &&
      candidate.snapshotAccepted === false &&
      candidate.snapshotManifestWritten === false &&
      candidate.refusedBeforeSnapshot === true,
  );
  if (!refusal || realAppReport?.accepted !== true) {
    return missingRefusal(row, direction, generic, "real-app refusal row missing");
  }
  return {
    rowId: row.id,
    direction,
    status: "covered",
    source: "real-app-refusal-corpus",
    marker,
    artifact:
      "proofs/nodejs/claim-evidence-index/retained/refusals/real-app/node-level5-real-app-refusal-corpus-report.json",
    expectedRefusalCode: refusal.expectedRefusalCode,
  };
}

function missingRefusal(
  row: NodeLevel5AppSupportMatrixRow,
  direction: Direction,
  generic: boolean,
  missingReason: string,
): RefusedDirectionCoverage {
  return {
    rowId: row.id,
    direction,
    status: "missing",
    source: generic ? "generic-vm-refusal-artifacts" : "real-app-refusal-corpus",
    marker: markerForRowId(row.id) ?? "unknown",
    artifact: "missing",
    missingReason,
  };
}

function markerForRowId(rowId: string): string | undefined {
  const withoutFramework = rowId.replace(/^(express|fastify)-/u, "");
  const suffix = withoutFramework.replace(/^generic-vm-/u, "");
  return markerBySuffix.get(suffix);
}

function notProvenBlocker(row: NodeLevel5AppSupportMatrixRow): NotProvenRow {
  return {
    rowId: row.id,
    framework: row.framework,
    appName: row.appName,
    reason: row.supportedAppShape,
    requiredResolution: "support-with-retained-e2e",
  };
}

function readJson(path: string): unknown {
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function displayRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, displayPath(value)]));
}

function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? path : rel;
}

function parseArgs(args: string[]): { root: string; out?: string; json: boolean } {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, "../../..");
  const parsed: { root: string; out?: string; json: boolean } = {
    root: join(repoRoot, "proofs/nodejs"),
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--root") {
      parsed.root = takeValue(args, ++index, arg);
      continue;
    }
    if (arg === "--out") {
      parsed.out = takeValue(args, ++index, arg);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
