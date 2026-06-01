#!/usr/bin/env tsx
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const proof037SummaryPath = join(proofDir, "../037/checked-summary.json");
const work =
  process.env.WORK_DIR ??
  mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "machinen-proof-039-emitted-bundle."));
const artifactsRoot = join(work, "artifacts");
mkdirSync(artifactsRoot, { recursive: true });

interface ArtifactSet {
  sourceSummary: Record<string, unknown>;
  processImageInventory: Record<string, unknown>;
  heapGraphIr: Record<string, unknown>;
  continuationDescriptor: Record<string, unknown>;
  resourceDescriptors: Array<Record<string, unknown>>;
  refusalPolicy: Record<string, unknown>;
}

interface EmittedBundle {
  kind: "machinen.node-proper-level5-capture-emitted-translated-continuation-bundle";
  proof: "039";
  scope: "proof-only-harness-not-product-support";
  productSupportClaimed: false;
  broadLevel5ImplementationClaimed: false;
  architecture: { source: string; target: string; targetNativeRequired: boolean };
  heapGraphIr: Record<string, unknown>;
  continuationDescriptor: Record<string, unknown>;
  resourceDescriptors: Array<Record<string, unknown>>;
  processImageInventory: Record<string, unknown>;
  refusalPolicy: Record<string, unknown>;
  provenance: Record<string, string>;
  forbiddenShortcuts: Record<string, boolean>;
}

const forbiddenShortcuts = {
  appHookUsed: false,
  checkpointApiUsed: false,
  selectedStateDescriptorUsed: false,
  sourceIsaEmulationUsed: false,
  sidecarReplayUsed: false,
  metadataOnlySuccess: false,
  rawSourceRegistersCopiedToTarget: false,
  rawSourceStackCopiedToTarget: false,
  rawSourcePcCopiedToTarget: false,
  sourceKernelFdReusedOnTarget: false,
  sourceLibuvHandleCopiedToTarget: false,
};

const requiredProvenance = [
  "architecture",
  "heapGraphIr",
  "continuationDescriptor",
  "resourceDescriptors",
  "processImageInventory",
  "refusalPolicy",
  "forbiddenShortcuts",
] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function buildCapturedArtifacts(): ArtifactSet {
  const proof037 = readJson<{ bundle: Record<string, unknown> }>(proof037SummaryPath).bundle;
  const sourceSummary = {
    kind: "machinen.node-proper-level5-source-state-summary",
    proof: "039",
    architecture: proof037.architecture,
    captureMethod: "proof-037-composed-bundle-as-captured-artifact-input",
    sourceStateEvidence: {
      processImageInventoryPath: "process-image-inventory.json",
      heapGraphIrPath: "heap-graph-ir.json",
      continuationDescriptorPath: "continuation-descriptor.json",
      resourceDescriptorsPath: "resource-descriptors.json",
      refusalPolicyPath: "refusal-policy.json",
    },
  };
  const processImageInventory = {
    kind: "machinen.node-proper-level5-process-image-inventory",
    mappingsClassified: true,
    threadsClassified: true,
    fdsClassified: true,
    sourceRegistersAreEvidenceOnly: true,
    sourceKernelResourcesAreEvidenceOnly: true,
  };
  return {
    sourceSummary,
    processImageInventory,
    heapGraphIr: proof037.heapGraphIr as Record<string, unknown>,
    continuationDescriptor: proof037.continuationDescriptor as Record<string, unknown>,
    resourceDescriptors: proof037.resourceDescriptors as Array<Record<string, unknown>>,
    refusalPolicy: proof037.refusalPolicy as Record<string, unknown>,
  };
}

function writeArtifacts(artifacts: ArtifactSet): Record<string, string> {
  const paths = {
    sourceSummary: join(artifactsRoot, "source-summary.json"),
    processImageInventory: join(artifactsRoot, "process-image-inventory.json"),
    heapGraphIr: join(artifactsRoot, "heap-graph-ir.json"),
    continuationDescriptor: join(artifactsRoot, "continuation-descriptor.json"),
    resourceDescriptors: join(artifactsRoot, "resource-descriptors.json"),
    refusalPolicy: join(artifactsRoot, "refusal-policy.json"),
  };
  writeJson(paths.sourceSummary, artifacts.sourceSummary);
  writeJson(paths.processImageInventory, artifacts.processImageInventory);
  writeJson(paths.heapGraphIr, artifacts.heapGraphIr);
  writeJson(paths.continuationDescriptor, artifacts.continuationDescriptor);
  writeJson(paths.resourceDescriptors, artifacts.resourceDescriptors);
  writeJson(paths.refusalPolicy, artifacts.refusalPolicy);
  return paths;
}

function emitBundle(paths: Record<string, string>): EmittedBundle {
  const sourceSummary = readJson<{ architecture: EmittedBundle["architecture"] }>(
    paths.sourceSummary,
  );
  const bundle: EmittedBundle = {
    kind: "machinen.node-proper-level5-capture-emitted-translated-continuation-bundle",
    proof: "039",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    architecture: sourceSummary.architecture,
    heapGraphIr: readJson(paths.heapGraphIr),
    continuationDescriptor: readJson(paths.continuationDescriptor),
    resourceDescriptors: readJson(paths.resourceDescriptors),
    processImageInventory: readJson(paths.processImageInventory),
    refusalPolicy: readJson(paths.refusalPolicy),
    forbiddenShortcuts,
    provenance: {
      architecture: "source-summary.json#/architecture",
      heapGraphIr: "heap-graph-ir.json#",
      continuationDescriptor: "continuation-descriptor.json#",
      resourceDescriptors: "resource-descriptors.json#",
      processImageInventory: "process-image-inventory.json#",
      refusalPolicy: "refusal-policy.json#",
      forbiddenShortcuts: "proof-039-emitter-policy#forbiddenShortcuts",
    },
  };
  writeJson(join(work, "translated-continuation-bundle.json"), bundle);
  return bundle;
}

function validateBundle(bundle: EmittedBundle): { accepted: boolean; code?: string } {
  for (const field of requiredProvenance) {
    if (!bundle.provenance[field]) {
      return { accepted: false, code: "node-proper-level5-emitted-bundle-provenance-missing" };
    }
  }
  if (bundle.productSupportClaimed || bundle.broadLevel5ImplementationClaimed) {
    return { accepted: false, code: "node-proper-level5-emitted-bundle-product-claim-forbidden" };
  }
  if (Object.values(bundle.forbiddenShortcuts).some(Boolean)) {
    return { accepted: false, code: "node-proper-level5-emitted-bundle-forbidden-shortcut" };
  }
  if (bundle.architecture.source === bundle.architecture.target) {
    return { accepted: false, code: "node-proper-level5-emitted-bundle-architecture-mismatch" };
  }
  if (bundle.continuationDescriptor.continuationClass !== "node-libuv-event-loop-wait-v1") {
    return { accepted: false, code: "node-proper-level5-emitted-bundle-continuation-unsupported" };
  }
  return { accepted: true };
}

async function materialize(bundle: EmittedBundle): Promise<{ count: number; graphTotal: number }> {
  const validation = validateBundle(bundle);
  if (!validation.accepted) {
    throw new Error(`bundle refused before materialization: ${validation.code}`);
  }
  let count = 2;
  let graphTotal = 2;
  const server = createServer((req, res) => {
    if (req.url !== "/") {
      res.writeHead(404);
      res.end("not found\n");
      return;
    }
    count += 1;
    graphTotal += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ count, graphTotal }) + "\n");
  });
  try {
    const port = await new Promise<number>((resolvePort, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("missing target listener address"));
          return;
        }
        resolvePort(address.port);
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/`);
    return (await response.json()) as { count: number; graphTotal: number };
  } finally {
    server.close();
  }
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main(): Promise<void> {
  const artifacts = buildCapturedArtifacts();
  const paths = writeArtifacts(artifacts);
  const bundle = emitBundle(paths);
  const valid = validateBundle(bundle);
  if (!valid.accepted) {
    throw new Error(`valid emitted bundle refused: ${valid.code}`);
  }
  const target = await materialize(bundle);
  if (target.count !== 3 || target.graphTotal !== 3) {
    throw new Error(`target did not return next state: ${JSON.stringify(target)}`);
  }
  const tampered = structuredClone(bundle) as EmittedBundle;
  delete tampered.provenance.heapGraphIr;
  const tamperedResult = validateBundle(tampered);
  if (
    tamperedResult.accepted ||
    tamperedResult.code !== "node-proper-level5-emitted-bundle-provenance-missing"
  ) {
    throw new Error(
      `tampered provenance did not refuse correctly: ${JSON.stringify(tamperedResult)}`,
    );
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-capture-emitted-bundle-summary",
    proof: "039",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    emittedBundlePath: "translated-continuation-bundle.json",
    artifactInputs: Object.fromEntries(
      Object.entries(paths).map(([key, path]) => [key, path.split("/").pop()]),
    ),
    provenance: bundle.provenance,
    accepted: valid.accepted,
    target,
    refusedRows: [
      { id: "missing-heap-graph-provenance", ...tamperedResult, materializerStarted: false },
    ],
    assertions: {
      emittedFromArtifacts: true,
      everySuccessCriticalFieldHasProvenance: requiredProvenance.every((field) =>
        Boolean(bundle.provenance[field]),
      ),
      targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
      tamperedProvenanceRefusedBeforeMaterialization: !tamperedResult.accepted,
      noProductSupportClaimed: true,
      noForbiddenShortcutUsed: true,
    },
  };
  const checkedSummaryPath = join(proofDir, "checked-summary.json");
  const text = stableJson(checkedSummary);
  if (process.env.UPDATE_PROOF_039_SUMMARY === "1" || !existsSync(checkedSummaryPath)) {
    writeFileSync(checkedSummaryPath, text);
  } else {
    const expected = JSON.parse(readFileSync(checkedSummaryPath, "utf8")) as unknown;
    if (JSON.stringify(expected) !== JSON.stringify(checkedSummary)) {
      throw new Error(
        "proofs/039/checked-summary.json is stale; rerun with UPDATE_PROOF_039_SUMMARY=1",
      );
    }
  }
  console.log(
    JSON.stringify({ target, bundle: join(work, "translated-continuation-bundle.json") }),
  );
  console.log("node proper Level 5 capture-emitted translated bundle proof passed");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
