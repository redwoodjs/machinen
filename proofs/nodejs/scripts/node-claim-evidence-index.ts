import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNodeLevel5AppSupportMatrix } from "../../../packages/runtime/src/node-level5-app-support-matrix.ts";
import { NODE_LEVEL5_PRODUCT_REFUSAL_MARKERS } from "../../../packages/runtime/src/node-level5-product-snapshot.ts";
import { buildNodeClaimRowCoverageReport } from "./node-claim-row-coverage.ts";

type NumberedBucket = {
  id: string;
  path: string;
  classification: string;
  claimUse: "proof-substrate" | "release-gate-substrate" | "historical-proof";
  numberedProofCount: number;
  checkedSummaryCount: number;
  smokeCount: number;
  ranges: string[];
  claimBearingWithoutRetainedE2eLink: false;
};

type ClaimFolder = {
  id: string;
  path: string;
  classification: string;
  status: string;
  claimBearing: boolean;
  reason: string;
};

type RetainedGate = {
  id: string;
  path: string;
  classification: "retained-real-product-e2e-seed";
  accepted: boolean;
  rowCount: number;
  verifiedDirections: string[];
  claimUse: "seed-evidence-only";
  claimBearingFor100: false;
  stillRequired: string[];
};

type RefusalDefinitionSummary = {
  realAppRefusalMarkers: string[];
  realAppRefusalMarkerCount: number;
  realAppExpectedRows: number;
  genericVmRefusalMarkers: string[];
  genericVmRefusalMarkerCount: number;
  genericVmExpectedRows: number;
  supportMatrixRefusedRows: number;
  supportMatrixNotProvenRows: number;
  retainedReports: Array<{ id: string; path: string; accepted: boolean; rowCount?: number }>;
  status: "defined-but-not-all-claim-retained" | "claim-ready-retained";
};

type RetainedHardeningReport = {
  id: string;
  path: string;
  accepted: boolean;
  role: "boundary-guard" | "verifier-integrity" | "artifact-integrity";
};

type NodeClaimEvidenceIndexReport = {
  kind: "machinen.node-claim-evidence-index-report";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  publicClaimAllowed: boolean;
  publicClaim: {
    productSupport: 0 | 100;
    broadSupport: 0 | 100;
    arbitraryProcessCrossArchRestore: 0;
  };
  summary: string;
  numberedBuckets: NumberedBucket[];
  claimFolders: ClaimFolder[];
  retainedGates: RetainedGate[];
  retainedHardeningReports: RetainedHardeningReport[];
  refusalDefinitions: RefusalDefinitionSummary;
  consolidationPolicy: {
    singleGate: true;
    keepShardedProofs: true;
    reason: string;
  };
  nextRequiredForClaimRaise: string[];
};

const numberedBucketClassifications: Record<
  string,
  { classification: string; claimUse: NumberedBucket["claimUse"] }
> = {
  "proper-level5-numbered": {
    classification: "proper Level 5 low-level/runtime/state proof corpus",
    claimUse: "historical-proof",
  },
  "misc-numbered": {
    classification: "miscellaneous historical Node proof corpus",
    claimUse: "historical-proof",
  },
  "product-path-numbered": {
    classification: "product-path and product-surface proof corpus",
    claimUse: "proof-substrate",
  },
  "product-support-numbered": {
    classification: "Node product support ladder substrate",
    claimUse: "proof-substrate",
  },
  "app-corpus-numbered": {
    classification: "Node app corpus, real-app, and refusal corpus substrate",
    claimUse: "proof-substrate",
  },
  "http-behavior-numbered": {
    classification: "HTTP/framework behavior proof corpus",
    claimUse: "proof-substrate",
  },
  "release-gates-numbered": {
    classification: "release-gate proof corpus",
    claimUse: "release-gate-substrate",
  },
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildNodeClaimEvidenceIndexReport(options.root);
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `node claim evidence index: ${report.numberedBuckets.length} numbered buckets, ${report.retainedGates.length} retained gate(s), public claim allowed=${report.publicClaimAllowed}\n`,
    );
  }
}

export function buildNodeClaimEvidenceIndexReport(root: string): NodeClaimEvidenceIndexReport {
  const resolvedRoot = resolve(root);
  const matrix = buildNodeLevel5AppSupportMatrix();
  const rowCoverage = buildNodeClaimRowCoverageReport(resolvedRoot);
  const retainedHardeningReports = readRetainedHardeningReports(resolvedRoot);
  const publicClaimAllowed =
    rowCoverage.claimAllowed && retainedHardeningReports.every((report) => report.accepted);
  const retainedGates = [readRetainedE2eGate(resolvedRoot)];
  const realAppRefusalSummary = readJson(
    join(resolvedRoot, "claim-evidence-index/retained/refusals/real-app-summary.json"),
  );
  const genericVmRefusalSummary = readJson(
    join(
      resolvedRoot,
      "claim-evidence-index/retained/refusals/generic-vm-refusal-artifacts-summary.json",
    ),
  );
  return {
    kind: "machinen.node-claim-evidence-index-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted: publicClaimAllowed,
    publicClaimAllowed,
    publicClaim: {
      productSupport: publicClaimAllowed ? 100 : 0,
      broadSupport: publicClaimAllowed ? 100 : 0,
      arbitraryProcessCrossArchRestore: 0,
    },
    summary: publicClaimAllowed
      ? "Consolidated Node proof index. Historical numbered proofs remain sharded; the retained-artifact gate now links every supported/refused row to validated E2E or refusal evidence, so the selected Node service claim may be 100 / 100 / 0."
      : "Consolidated Node proof index. Historical numbered proofs remain sharded, but public claims must flow through this retained-artifact gate and stay 0 / 0 / 0 until every supported/refused row is linked to validated retained E2E evidence.",
    numberedBuckets: Object.keys(numberedBucketClassifications).map((bucket) =>
      inspectNumberedBucket(resolvedRoot, bucket),
    ),
    claimFolders: [inspect100ClaimFolder(resolvedRoot)],
    retainedGates,
    retainedHardeningReports,
    refusalDefinitions: {
      realAppRefusalMarkers: NODE_LEVEL5_PRODUCT_REFUSAL_MARKERS.map(([marker]) => marker),
      realAppRefusalMarkerCount: NODE_LEVEL5_PRODUCT_REFUSAL_MARKERS.length,
      realAppExpectedRows: NODE_LEVEL5_PRODUCT_REFUSAL_MARKERS.length * 2 * 2,
      genericVmRefusalMarkers: [
        "activeRequests",
        "workerThreads",
        "nativeAddons",
        "tlsActiveState",
        "childProcesses",
      ],
      genericVmRefusalMarkerCount: 5,
      genericVmExpectedRows: 5 * 2 * 2,
      supportMatrixRefusedRows: matrix.rows.filter((row) => row.status === "refused").length,
      supportMatrixNotProvenRows: matrix.rows.filter((row) => row.status === "not-proven").length,
      retainedReports: [
        {
          id: "real-app-refusal-corpus",
          path: "proofs/nodejs/claim-evidence-index/retained/refusals/real-app-summary.json",
          accepted: realAppRefusalSummary?.accepted === true,
          rowCount: Number(realAppRefusalSummary?.rowCount ?? 0),
        },
        {
          id: "generic-vm-refusal-artifacts",
          path: "proofs/nodejs/claim-evidence-index/retained/refusals/generic-vm-refusal-artifacts-summary.json",
          accepted: genericVmRefusalSummary?.accepted === true,
          rowCount: Number(genericVmRefusalSummary?.refusalArtifactFileCount ?? 0),
        },
      ],
      status: publicClaimAllowed ? "claim-ready-retained" : "defined-but-not-all-claim-retained",
    },
    consolidationPolicy: {
      singleGate: true,
      keepShardedProofs: true,
      reason:
        "Keep the numbered proofs as granular regression shards, but use one claim-facing evidence index/gate to prevent stale summaries or facade-only reports from raising public claims.",
    },
    nextRequiredForClaimRaise: publicClaimAllowed
      ? [
          "Keep every supported row linked to retained source command, target command, manifest, restore summary, verifier output, and hashes.",
          "Keep refused row coverage complete and fail closed for unsupported live state.",
          "Keep arbitrary process cross-architecture restore at 0; this claim is selected Node service support only.",
        ]
      : [
          "Run or salvage retained product E2E artifacts for every supported Node support-matrix row in both architecture directions.",
          "Retain refusal artifacts for every refused support-matrix row and every product refusal marker.",
          "Link each row to exact retained source command, target command, manifest, restore summary, verifier output, and hashes.",
          "Fail the gate if any row is only a checked summary, facade/unit test, stale numbered proof, metadata-only success, app hook, sidecar, source-ISA emulation, or raw CPU restore.",
        ],
  };
}

function readRetainedHardeningReports(root: string): RetainedHardeningReport[] {
  return [
    retainedHardeningReport(
      root,
      "node-claim-boundary-guard",
      "claim-evidence-index/retained/node-claim-boundary-guard-report.json",
      "boundary-guard",
    ),
    retainedHardeningReport(
      root,
      "node-row-verifier-integrity",
      "claim-evidence-index/retained/node-row-verifier-integrity-report.json",
      "verifier-integrity",
    ),
    retainedHardeningReport(
      root,
      "node-artifact-integrity-manifest",
      "claim-evidence-index/retained/node-artifact-integrity-manifest.json",
      "artifact-integrity",
    ),
  ];
}

function retainedHardeningReport(
  root: string,
  id: string,
  path: string,
  role: RetainedHardeningReport["role"],
): RetainedHardeningReport {
  const absolutePath = join(root, path);
  const report = readJson(absolutePath);
  return {
    id,
    path: displayPath(absolutePath),
    role,
    accepted: report?.accepted === true,
  };
}

function inspectNumberedBucket(root: string, bucket: string): NumberedBucket {
  const path = join(root, bucket);
  const dirs = existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
        .map((entry) => Number(entry.name))
        .sort((a, b) => a - b)
    : [];
  const info = numberedBucketClassifications[bucket]!;
  return {
    id: bucket,
    path: displayPath(path),
    classification: info.classification,
    claimUse: info.claimUse,
    numberedProofCount: dirs.length,
    checkedSummaryCount: countExisting(path, dirs, "checked-summary.json"),
    smokeCount: countExisting(path, dirs, "smoke.ts"),
    ranges: ranges(dirs),
    claimBearingWithoutRetainedE2eLink: false,
  };
}

function inspect100ClaimFolder(root: string): ClaimFolder {
  const path = join(root, "100-100-0");
  const claim = readJson(join(path, "claim.json"));
  return {
    id: "100-100-0",
    path: displayPath(path),
    classification: "unverified previous public claim shell",
    status: String(claim?.status ?? "unknown"),
    claimBearing: false,
    reason:
      "This folder is retained as history, but it is not claim-bearing until the consolidated retained E2E gate links all rows and refusals.",
  };
}

function readRetainedE2eGate(root: string): RetainedGate {
  const path = join(root, "real-cross-arch-e2e-gate");
  const reportPath = join(path, "retained", "node-real-cross-arch-e2e-gate-report.json");
  const report = readJson(reportPath);
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  return {
    id: "real-cross-arch-e2e-gate",
    path: displayPath(path),
    classification: "retained-real-product-e2e-seed",
    accepted: report?.accepted === true,
    rowCount: rows.length,
    verifiedDirections: rows
      .filter((row: any) => row.accepted === true)
      .map((row: any) => String(row.direction)),
    claimUse: "seed-evidence-only",
    claimBearingFor100: false,
    stillRequired: Array.isArray(report?.stillRequiredBefore100)
      ? report.stillRequiredBefore100.map(String)
      : ["full row coverage and refusal artifacts"],
  };
}

function countExisting(path: string, dirs: number[], file: string): number {
  return dirs.filter((dir) => existsSync(join(path, String(dir), file))).length;
}

function ranges(nums: number[]): string[] {
  if (nums.length === 0) {
    return [];
  }
  const out: string[] = [];
  let start = nums[0]!;
  let prev = nums[0]!;
  for (const n of nums.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    out.push(formatRange(start, prev));
    start = n;
    prev = n;
  }
  out.push(formatRange(start, prev));
  return out;
}

function formatRange(start: number, end: number): string {
  return start === end ? String(start) : `${start}-${end}`;
}

function readJson(path: string): any {
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, "utf8"));
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
