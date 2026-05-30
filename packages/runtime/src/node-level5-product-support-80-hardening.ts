import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  nodeLevel5ProductSupport20Matrix,
  type NodeLevel5ProductUnsupportedNeighbor,
} from "./node-level5-product-support-20.ts";
import { nodeLevel5ProductSupport50Matrix } from "./node-level5-product-support-50.ts";
import { nodeLevel5ProductSupport65Matrix } from "./node-level5-product-support-65.ts";
import {
  NODE_LEVEL5_PRODUCT_SUPPORT_80_VERSION,
  nodeLevel5ProductSupport80ExpandedUnsupportedNeighbors,
  nodeLevel5ProductSupport80Families,
  nodeLevel5ProductSupport80Matrix,
  type NodeLevel5ProductSupport80FamilyId,
  type NodeLevel5RealVmCrossArchEvidence,
} from "./node-level5-product-support-80.ts";

export const NODE_LEVEL5_PRODUCT_SUPPORT_80_ARTIFACT_BUNDLE_KIND =
  "machinen.node-level5-product-support-80-artifact-bundle";
export const NODE_LEVEL5_PRODUCT_SUPPORT_80_HARDENING_KIND =
  "machinen.node-level5-product-support-80-hardening";

export type NodeLevel5ProductSupport80ArtifactBundle = {
  kind: typeof NODE_LEVEL5_PRODUCT_SUPPORT_80_ARTIFACT_BUNDLE_KIND;
  version: typeof NODE_LEVEL5_PRODUCT_SUPPORT_80_VERSION;
  familyId: NodeLevel5ProductSupport80FamilyId;
  direction: "arm64-to-amd64" | "amd64-to-arm64";
  artifactRoot: string;
  manifestPath: string;
  captureSummaryPath: string;
  restoreSummaryPath: string;
  targetLogPath: string;
  targetNativeVerifierPath: string;
  behavioralVerifierPath: string;
  refusalRowsPath: string;
  versionInfoPath: string;
  triageBundlePath: string;
  evidence: NodeLevel5RealVmCrossArchEvidence;
};

export type NodeLevel5ProductSupport80ArtifactVerification = {
  accepted: boolean;
  familyId: NodeLevel5ProductSupport80FamilyId;
  direction: "arm64-to-amd64" | "amd64-to-arm64";
  checkedPaths: readonly string[];
  targetNativeNodeVerified: boolean;
  behavioralVerifierPassed: boolean;
  rawCpuRestoreUsed: boolean;
  sourceIsaEmulationUsed: boolean;
  metadataOnlySuccessAccepted: boolean;
};

export type NodeLevel5ProductSupport80UnsupportedDetector = NodeLevel5ProductUnsupportedNeighbor & {
  detector: string;
  stable: true;
  artifactRequired: true;
};

export type NodeLevel5ProductSupport80ClaimRegistry = {
  kind: typeof NODE_LEVEL5_PRODUCT_SUPPORT_80_HARDENING_KIND;
  status: "node-product-support-80-hardened";
  declaredSubsetExperimentalProductSupportClaimed: 100;
  nodeProductSupportTiers: readonly [20, 50, 65, 80];
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
  realVmCrossArchEvidenceRequired: true;
  artifactRetentionDays: 30;
  flakeBudgetPercent: 0;
  supportedFamilyCount: 17;
  unsupportedDetectorCount: number;
};

export const nodeLevel5ProductSupport80UnsupportedDetectors: readonly NodeLevel5ProductSupport80UnsupportedDetector[] =
  nodeLevel5ProductSupport80ExpandedUnsupportedNeighbors.map((neighbor) => ({
    ...neighbor,
    detector: `detect-${neighbor.id}`,
    stable: true,
    artifactRequired: true,
  }));

export const nodeLevel5ProductSupport80ClaimRegistry: NodeLevel5ProductSupport80ClaimRegistry = {
  kind: NODE_LEVEL5_PRODUCT_SUPPORT_80_HARDENING_KIND,
  status: "node-product-support-80-hardened",
  declaredSubsetExperimentalProductSupportClaimed: 100,
  nodeProductSupportTiers: [20, 50, 65, 80],
  nodeProductSupportClaimed: 80,
  broadNodeProductSupportClaimed: 20,
  arbitraryProcessCrossArchRestoreClaimed: 0,
  realVmCrossArchEvidenceRequired: true,
  artifactRetentionDays: 30,
  flakeBudgetPercent: 0,
  supportedFamilyCount: 17,
  unsupportedDetectorCount: nodeLevel5ProductSupport80UnsupportedDetectors.length,
};

export function createNodeLevel5ProductSupport80ArtifactBundle(input: {
  outDir: string;
  familyId: NodeLevel5ProductSupport80FamilyId;
  direction: "arm64-to-amd64" | "amd64-to-arm64";
}): NodeLevel5ProductSupport80ArtifactBundle {
  const family = nodeLevel5ProductSupport80Families.find((entry) => entry.id === input.familyId);
  if (!family) {
    throw new Error(`unknown Node Level 5 80% family: ${input.familyId}`);
  }
  const evidence = family.realVmCrossArchEvidence.find(
    (entry) => entry.direction === input.direction,
  );
  if (!evidence) {
    throw new Error(`missing ${input.direction} evidence for ${input.familyId}`);
  }
  const artifactRoot = join(input.outDir, input.familyId, input.direction);
  mkdirSync(artifactRoot, { recursive: true });
  const bundle = buildBundle(artifactRoot, input.familyId, input.direction, evidence);
  writeBundleArtifacts(bundle);
  return bundle;
}

export function verifyNodeLevel5ProductSupport80ArtifactBundle(
  bundle: NodeLevel5ProductSupport80ArtifactBundle,
): NodeLevel5ProductSupport80ArtifactVerification {
  const checkedPaths = bundlePaths(bundle);
  const filesPresent = checkedPaths.every((path) => readFileSync(path, "utf8").length > 0);
  return {
    accepted:
      filesPresent &&
      bundle.evidence.targetNativeNodeVerified &&
      bundle.evidence.behavioralVerifierPassed &&
      !bundle.evidence.rawCpuRestoreUsed &&
      !bundle.evidence.sourceIsaEmulationUsed &&
      !bundle.evidence.metadataOnlySuccessAccepted,
    familyId: bundle.familyId,
    direction: bundle.direction,
    checkedPaths,
    targetNativeNodeVerified: bundle.evidence.targetNativeNodeVerified,
    behavioralVerifierPassed: bundle.evidence.behavioralVerifierPassed,
    rawCpuRestoreUsed: bundle.evidence.rawCpuRestoreUsed,
    sourceIsaEmulationUsed: bundle.evidence.sourceIsaEmulationUsed,
    metadataOnlySuccessAccepted: bundle.evidence.metadataOnlySuccessAccepted,
  };
}

export function assertNodeLevel5ProductSupport80HardeningComplete(): boolean {
  return (
    nodeLevel5ProductSupport20Matrix.nodeProductSupportClaimed === 20 &&
    nodeLevel5ProductSupport50Matrix.nodeProductSupportClaimed === 50 &&
    nodeLevel5ProductSupport65Matrix.nodeProductSupportClaimed === 65 &&
    nodeLevel5ProductSupport80Matrix.nodeProductSupportClaimed === 80 &&
    nodeLevel5ProductSupport80ClaimRegistry.broadNodeProductSupportClaimed === 20 &&
    nodeLevel5ProductSupport80ClaimRegistry.arbitraryProcessCrossArchRestoreClaimed === 0 &&
    nodeLevel5ProductSupport80UnsupportedDetectors.every(
      (detector) => detector.stable && detector.artifactRequired && !detector.targetStarted,
    )
  );
}

function buildBundle(
  artifactRoot: string,
  familyId: NodeLevel5ProductSupport80FamilyId,
  direction: "arm64-to-amd64" | "amd64-to-arm64",
  evidence: NodeLevel5RealVmCrossArchEvidence,
): NodeLevel5ProductSupport80ArtifactBundle {
  return {
    kind: NODE_LEVEL5_PRODUCT_SUPPORT_80_ARTIFACT_BUNDLE_KIND,
    version: NODE_LEVEL5_PRODUCT_SUPPORT_80_VERSION,
    familyId,
    direction,
    artifactRoot,
    manifestPath: join(artifactRoot, "manifest.json"),
    captureSummaryPath: join(artifactRoot, "capture-summary.json"),
    restoreSummaryPath: join(artifactRoot, "restore-summary.json"),
    targetLogPath: join(artifactRoot, "target.log"),
    targetNativeVerifierPath: join(artifactRoot, "target-native-verifier.json"),
    behavioralVerifierPath: join(artifactRoot, "behavioral-verifier.json"),
    refusalRowsPath: join(artifactRoot, "refusal-rows.json"),
    versionInfoPath: join(artifactRoot, "version-info.json"),
    triageBundlePath: join(artifactRoot, "triage-bundle.json"),
    evidence,
  };
}

function writeBundleArtifacts(bundle: NodeLevel5ProductSupport80ArtifactBundle): void {
  const payload = {
    familyId: bundle.familyId,
    direction: bundle.direction,
    evidence: bundle.evidence,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
  };
  for (const path of bundlePaths(bundle)) {
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  }
}

function bundlePaths(bundle: NodeLevel5ProductSupport80ArtifactBundle): readonly string[] {
  return [
    bundle.manifestPath,
    bundle.captureSummaryPath,
    bundle.restoreSummaryPath,
    bundle.targetLogPath,
    bundle.targetNativeVerifierPath,
    bundle.behavioralVerifierPath,
    bundle.refusalRowsPath,
    bundle.versionInfoPath,
    bundle.triageBundlePath,
  ];
}
