import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createNodeLevel5ProductSupport80ArtifactBundle,
  loadNodeLevel5ProductSupport80ArtifactBundle,
  nodeLevel5ProductSupport80ClaimRegistry,
  verifyNodeLevel5ProductSupport80ArtifactBundle,
} from "./node-level5-product-support-80-hardening.ts";
import type { NodeLevel5ProductSupport80FamilyId } from "./node-level5-product-support-80.ts";

export const NODE_LEVEL5_PRODUCT_SNAPSHOT_KIND = "machinen.node-level5-product-snapshot";
export const NODE_LEVEL5_PRODUCT_SNAPSHOT_VERSION = 1;
export const DEFAULT_NODE_LEVEL5_PRODUCT_SNAPSHOT_FAMILY = "express-fastify-http-app";
export const DEFAULT_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION = "arm64-to-amd64";

export type NodeLevel5ProductSnapshotDirection = "arm64-to-amd64" | "amd64-to-arm64";

export type NodeLevel5ProductSnapshotManifest = {
  kind: typeof NODE_LEVEL5_PRODUCT_SNAPSHOT_KIND;
  version: typeof NODE_LEVEL5_PRODUCT_SNAPSHOT_VERSION;
  status: "node-product-support-80";
  familyId: NodeLevel5ProductSupport80FamilyId;
  direction: NodeLevel5ProductSnapshotDirection;
  artifactRoot: string;
  artifactBundleKind: "machinen.node-level5-product-support-80-artifact-bundle";
  translatedContinuationRequired: true;
  targetNativeNodeRequired: true;
  rawCpuRestoreSupported: false;
  sourceIsaEmulationSupported: false;
  appCheckpointHooksRequired: false;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5ProductSnapshotSummary = {
  kind: "machinen.node-level5-product-snapshot-summary";
  accepted: boolean;
  snapshotDir: string;
  manifestPath: string;
  manifest: NodeLevel5ProductSnapshotManifest;
};

export type NodeLevel5ProductRestoreSummary = {
  kind: "machinen.node-level5-product-restore-summary";
  accepted: boolean;
  snapshotDir: string;
  manifestPath: string;
  familyId: NodeLevel5ProductSupport80FamilyId;
  direction: NodeLevel5ProductSnapshotDirection;
  targetNativeNodeVerified: boolean;
  behavioralVerifierPassed: boolean;
  artifactHashesVerified: boolean;
  retentionComplete: boolean;
  translatedContinuationRequired: true;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export function createNodeLevel5ProductSnapshot(input: {
  outDir: string;
  familyId?: NodeLevel5ProductSupport80FamilyId;
  direction?: NodeLevel5ProductSnapshotDirection;
}): NodeLevel5ProductSnapshotSummary {
  const familyId = input.familyId ?? DEFAULT_NODE_LEVEL5_PRODUCT_SNAPSHOT_FAMILY;
  const direction = input.direction ?? DEFAULT_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION;
  mkdirSync(input.outDir, { recursive: true });
  const bundle = createNodeLevel5ProductSupport80ArtifactBundle({
    outDir: join(input.outDir, "artifacts"),
    familyId,
    direction,
  });
  const manifestPath = join(input.outDir, "node-level5-product-snapshot.json");
  const manifest: NodeLevel5ProductSnapshotManifest = {
    kind: NODE_LEVEL5_PRODUCT_SNAPSHOT_KIND,
    version: NODE_LEVEL5_PRODUCT_SNAPSHOT_VERSION,
    status: "node-product-support-80",
    familyId,
    direction,
    artifactRoot: join("artifacts", familyId, direction),
    artifactBundleKind: bundle.kind,
    translatedContinuationRequired: true,
    targetNativeNodeRequired: true,
    rawCpuRestoreSupported: false,
    sourceIsaEmulationSupported: false,
    appCheckpointHooksRequired: false,
    nodeProductSupportClaimed: nodeLevel5ProductSupport80ClaimRegistry.nodeProductSupportClaimed,
    broadNodeProductSupportClaimed:
      nodeLevel5ProductSupport80ClaimRegistry.broadNodeProductSupportClaimed,
    arbitraryProcessCrossArchRestoreClaimed:
      nodeLevel5ProductSupport80ClaimRegistry.arbitraryProcessCrossArchRestoreClaimed,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    kind: "machinen.node-level5-product-snapshot-summary",
    accepted: true,
    snapshotDir: input.outDir,
    manifestPath,
    manifest,
  };
}

export function isNodeLevel5ProductSnapshotBundle(snapshotDir: string): boolean {
  try {
    return isNodeLevel5ProductSnapshotManifest(readNodeLevel5ProductSnapshotManifest(snapshotDir));
  } catch {
    return false;
  }
}

export function restoreNodeLevel5ProductSnapshot(input: {
  snapshotDir: string;
}): NodeLevel5ProductRestoreSummary {
  const manifest = readNodeLevel5ProductSnapshotManifest(input.snapshotDir);
  if (!isNodeLevel5ProductSnapshotManifest(manifest)) {
    throw new Error("Node Level 5 product snapshot manifest is invalid");
  }
  const artifactRoot = join(input.snapshotDir, manifest.artifactRoot);
  const bundle = loadNodeLevel5ProductSupport80ArtifactBundle({
    artifactRoot,
    familyId: manifest.familyId,
    direction: manifest.direction,
  });
  const verification = verifyNodeLevel5ProductSupport80ArtifactBundle(bundle);
  return {
    kind: "machinen.node-level5-product-restore-summary",
    accepted: verification.accepted,
    snapshotDir: input.snapshotDir,
    manifestPath: manifestPathFor(input.snapshotDir),
    familyId: manifest.familyId,
    direction: manifest.direction,
    targetNativeNodeVerified: verification.targetNativeNodeVerified,
    behavioralVerifierPassed: verification.behavioralVerifierPassed,
    artifactHashesVerified: verification.artifactHashesVerified,
    retentionComplete: verification.retentionComplete,
    translatedContinuationRequired: true,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

function readNodeLevel5ProductSnapshotManifest(snapshotDir: string): unknown {
  return JSON.parse(readFileSync(manifestPathFor(snapshotDir), "utf8"));
}

function manifestPathFor(snapshotDir: string): string {
  return join(snapshotDir, "node-level5-product-snapshot.json");
}

function isNodeLevel5ProductSnapshotManifest(
  value: unknown,
): value is NodeLevel5ProductSnapshotManifest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<NodeLevel5ProductSnapshotManifest>;
  return (
    hasNodeLevel5ProductSnapshotIdentity(record) &&
    hasNodeLevel5ProductSnapshotSafety(record) &&
    hasNodeLevel5ProductSnapshotClaims(record) &&
    isNodeLevel5ProductSnapshotDirection(record.direction) &&
    typeof record.familyId === "string"
  );
}

function hasNodeLevel5ProductSnapshotIdentity(
  record: Partial<NodeLevel5ProductSnapshotManifest>,
): boolean {
  return (
    record.kind === NODE_LEVEL5_PRODUCT_SNAPSHOT_KIND &&
    record.version === NODE_LEVEL5_PRODUCT_SNAPSHOT_VERSION &&
    record.status === "node-product-support-80" &&
    typeof record.artifactRoot === "string"
  );
}

function hasNodeLevel5ProductSnapshotSafety(
  record: Partial<NodeLevel5ProductSnapshotManifest>,
): boolean {
  return (
    record.translatedContinuationRequired === true &&
    record.targetNativeNodeRequired === true &&
    record.rawCpuRestoreSupported === false &&
    record.sourceIsaEmulationSupported === false &&
    record.appCheckpointHooksRequired === false
  );
}

function hasNodeLevel5ProductSnapshotClaims(
  record: Partial<NodeLevel5ProductSnapshotManifest>,
): boolean {
  return (
    record.nodeProductSupportClaimed === 80 &&
    record.broadNodeProductSupportClaimed === 20 &&
    record.arbitraryProcessCrossArchRestoreClaimed === 0
  );
}

function isNodeLevel5ProductSnapshotDirection(
  value: unknown,
): value is NodeLevel5ProductSnapshotDirection {
  return value === "arm64-to-amd64" || value === "amd64-to-arm64";
}
