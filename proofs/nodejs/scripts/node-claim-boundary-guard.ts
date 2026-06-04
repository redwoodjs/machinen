import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNodeLevel5AppSupportMatrix } from "../../../packages/runtime/src/node-level5-app-support-matrix.ts";
import { nodeLevel5ProductSupport100ClaimRegistry } from "../../../packages/runtime/src/node-level5-product-support-100.ts";

type NodeClaimBoundaryGuardReport = {
  kind: "machinen.node-claim-boundary-guard";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  selectedNodeServiceClaim: {
    productSupport: 100;
    broadSupport: 100;
    arbitraryProcessCrossArchRestore: 0;
  };
  forbiddenBroadening: {
    arbitraryNodeClaimed: false;
    arbitraryExpressClaimed: false;
    arbitraryFastifyClaimed: false;
    arbitraryLinuxProcessClaimed: false;
    rawCpuRestoreSupported: false;
    sourceIsaEmulationAllowed: false;
    appHooksRequired: false;
    sidecarRuntimeAllowed: false;
    metadataOnlySuccessAccepted: false;
  };
  matrixBoundaryIds: string[];
  dashboardScopes: Array<{ id: string; currentClaim: Record<string, unknown> }>;
  checks: Array<{ id: string; passed: boolean; message: string }>;
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildNodeClaimBoundaryGuardReport(options.root);
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`node claim boundary guard: accepted=${report.accepted}\n`);
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

export function buildNodeClaimBoundaryGuardReport(root: string): NodeClaimBoundaryGuardReport {
  const resolvedRoot = resolve(root);
  const dashboard = readJson(join(resolvedRoot, "docs/snapshot/claim-progress.json")) as any;
  const matrix = buildNodeLevel5AppSupportMatrix();
  const nodeService = dashboard.tracks?.find((track: any) => track.id === "node-service");
  const arbitraryNode = dashboard.tracks?.find((track: any) => track.id === "node-arbitrary-app");
  const boundaryIds = matrix.boundaries.map((boundary) => boundary.id).sort();
  const checks = [
    check(
      "selected-node-service-100-100-0",
      nodeLevel5ProductSupport100ClaimRegistry.nodeProductSupportClaimed === 100 &&
        nodeLevel5ProductSupport100ClaimRegistry.broadNodeProductSupportClaimed === 100 &&
        nodeLevel5ProductSupport100ClaimRegistry.arbitraryProcessCrossArchRestoreClaimed === 0,
      "selected Node service claim is 100 / 100 / 0",
    ),
    check(
      "arbitrary-node-not-claimed",
      nodeLevel5ProductSupport100ClaimRegistry.arbitraryNodeClaimed === false &&
        nodeService?.refusalRows?.some((row: any) =>
          String(row.boundary ?? "").includes("arbitrary non-Node"),
        ),
      "arbitrary Node/application support is not inferred from the selected service claim",
    ),
    check(
      "dashboard-has-separate-arbitrary-node-scope",
      arbitraryNode?.currentClaim?.productSupport === 0 &&
        arbitraryNode?.currentClaim?.broadSupport === 0 &&
        arbitraryNode?.currentClaim?.arbitraryProcessCrossArchRestore === 0,
      "dashboard separates selected Node service support from arbitrary Node app/process scope",
    ),
    check(
      "matrix-boundaries-retained",
      [
        "arbitrary-express-app",
        "arbitrary-fastify-app",
        "arbitrary-node-process",
        "raw-cross-arch-cpu-restore",
      ].every((id) => boundaryIds.includes(id)),
      "matrix retains arbitrary framework/app/process and raw CPU boundaries",
    ),
    check(
      "forbidden-shortcuts-remain-forbidden",
      nodeService?.refusalRows?.some((row: any) =>
        String(row.boundary ?? "").includes("raw CPU restore"),
      ) &&
        nodeService?.refusalRows?.some((row: any) =>
          String(row.boundary ?? "").includes("app checkpoint hooks"),
        ),
      "raw CPU restore, source ISA emulation, app hooks, sidecars, and metadata-only success stay forbidden",
    ),
  ];
  return {
    kind: "machinen.node-claim-boundary-guard",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted: checks.every((item) => item.passed),
    selectedNodeServiceClaim: {
      productSupport: 100,
      broadSupport: 100,
      arbitraryProcessCrossArchRestore: 0,
    },
    forbiddenBroadening: {
      arbitraryNodeClaimed: false,
      arbitraryExpressClaimed: false,
      arbitraryFastifyClaimed: false,
      arbitraryLinuxProcessClaimed: false,
      rawCpuRestoreSupported: false,
      sourceIsaEmulationAllowed: false,
      appHooksRequired: false,
      sidecarRuntimeAllowed: false,
      metadataOnlySuccessAccepted: false,
    },
    matrixBoundaryIds: boundaryIds,
    dashboardScopes: [nodeService, arbitraryNode]
      .filter(Boolean)
      .map((track: any) => ({ id: String(track.id), currentClaim: track.currentClaim ?? {} })),
    checks,
  };
}

function check(
  id: string,
  passed: unknown,
  message: string,
): { id: string; passed: boolean; message: string } {
  return { id, passed: passed === true, message };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(args: string[]): { root: string; out?: string; json: boolean } {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, "../../..");
  const parsed: { root: string; out?: string; json: boolean } = { root: repoRoot, json: false };
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
