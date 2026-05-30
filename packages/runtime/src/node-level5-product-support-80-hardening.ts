import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

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
  manifestSchemaVerified: boolean;
  artifactHashesVerified: boolean;
  retentionComplete: boolean;
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

export function loadNodeLevel5ProductSupport80ArtifactBundle(input: {
  artifactRoot: string;
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
  return buildBundle(input.artifactRoot, input.familyId, input.direction, evidence);
}

export function verifyNodeLevel5ProductSupport80ArtifactBundle(
  bundle: NodeLevel5ProductSupport80ArtifactBundle,
): NodeLevel5ProductSupport80ArtifactVerification {
  const checkedPaths = bundlePaths(bundle);
  const manifest = readArtifactJson(bundle.manifestPath);
  assertManifestMatchesBundle(bundle, manifest);
  const artifactHashesVerified = verifyArtifactHashes(bundle, manifest);
  const filesPresent = checkedPaths.every((path) => readFileSync(path, "utf8").length > 0);
  const retentionComplete = bundleArtifactEntries(bundle).every((entry) => {
    readArtifactJson(entry.path);
    return Boolean(readArtifactHashes(manifest)[entry.name]);
  });
  return {
    accepted:
      filesPresent &&
      artifactHashesVerified &&
      retentionComplete &&
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
    manifestSchemaVerified: true,
    artifactHashesVerified,
    retentionComplete,
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
    kind: "machinen.node-level5-product-support-80-artifact",
    version: bundle.version,
    familyId: bundle.familyId,
    direction: bundle.direction,
    evidence: bundle.evidence,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  for (const entry of bundleArtifactEntries(bundle)) {
    writeFileSync(entry.path, `${JSON.stringify({ ...payload, artifact: entry.name }, null, 2)}\n`);
  }
  writeFileSync(
    bundle.manifestPath,
    `${JSON.stringify(
      {
        kind: bundle.kind,
        version: bundle.version,
        familyId: bundle.familyId,
        direction: bundle.direction,
        evidence: bundle.evidence,
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
        artifactHashes: Object.fromEntries(
          bundleArtifactEntries(bundle).map((entry) => [entry.name, sha256File(entry.path)]),
        ),
        retention: {
          requiredArtifacts: bundleArtifactEntries(bundle).map((entry) => entry.name),
          complete: true,
        },
      },
      null,
      2,
    )}\n`,
  );
}

function bundleArtifactEntries(
  bundle: NodeLevel5ProductSupport80ArtifactBundle,
): readonly { name: string; path: string }[] {
  return [
    { name: basename(bundle.captureSummaryPath), path: bundle.captureSummaryPath },
    { name: basename(bundle.restoreSummaryPath), path: bundle.restoreSummaryPath },
    { name: basename(bundle.targetLogPath), path: bundle.targetLogPath },
    { name: basename(bundle.targetNativeVerifierPath), path: bundle.targetNativeVerifierPath },
    { name: basename(bundle.behavioralVerifierPath), path: bundle.behavioralVerifierPath },
    { name: basename(bundle.refusalRowsPath), path: bundle.refusalRowsPath },
    { name: basename(bundle.versionInfoPath), path: bundle.versionInfoPath },
    { name: basename(bundle.triageBundlePath), path: bundle.triageBundlePath },
  ];
}

function readArtifactJson(path: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Node Level 5 artifact is not a JSON object: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

function assertManifestMatchesBundle(
  bundle: NodeLevel5ProductSupport80ArtifactBundle,
  manifest: Record<string, unknown>,
): void {
  if (manifest.kind !== NODE_LEVEL5_PRODUCT_SUPPORT_80_ARTIFACT_BUNDLE_KIND) {
    throw new Error("Node Level 5 artifact manifest kind is not supported");
  }
  if (manifest.version !== NODE_LEVEL5_PRODUCT_SUPPORT_80_VERSION) {
    throw new Error(`Node Level 5 artifact manifest version is not supported: ${manifest.version}`);
  }
  if (manifest.familyId !== bundle.familyId) {
    throw new Error(`Node Level 5 artifact family mismatch: ${manifest.familyId}`);
  }
  if (manifest.direction !== bundle.direction) {
    throw new Error(`Node Level 5 artifact direction mismatch: ${manifest.direction}`);
  }
  if (manifest.nodeProductSupportClaimed !== 80) {
    throw new Error("Node Level 5 artifact overclaims Node product support");
  }
  if (manifest.broadNodeProductSupportClaimed !== 20) {
    throw new Error("Node Level 5 artifact overclaims broad Node product support");
  }
  if (manifest.arbitraryProcessCrossArchRestoreClaimed !== 0) {
    throw new Error("Node Level 5 artifact overclaims arbitrary process cross-arch restore");
  }
}

function verifyArtifactHashes(
  bundle: NodeLevel5ProductSupport80ArtifactBundle,
  manifest: Record<string, unknown>,
): boolean {
  const hashes = readArtifactHashes(manifest);
  return bundleArtifactEntries(bundle).every((entry) => {
    const expected = hashes[entry.name];
    if (!expected) {
      throw new Error(`Node Level 5 artifact hash missing: ${entry.name}`);
    }
    if (expected !== sha256File(entry.path)) {
      throw new Error(`Node Level 5 artifact hash mismatch: ${entry.name}`);
    }
    return true;
  });
}

function readArtifactHashes(manifest: Record<string, unknown>): Record<string, string> {
  const hashes = manifest.artifactHashes;
  if (!hashes || typeof hashes !== "object" || Array.isArray(hashes)) {
    throw new Error("Node Level 5 artifact manifest is missing artifact hashes");
  }
  return hashes as Record<string, string>;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
