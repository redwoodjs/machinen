import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
export const NODE_LEVEL5_PRODUCT_DETECTOR_REPORT_KIND =
  "machinen.node-level5-product-detector-report";
export const NODE_LEVEL5_PRODUCT_TARGET_IDENTITY_KIND =
  "machinen.node-level5-product-target-identity";
export const DEFAULT_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION = "arm64-to-amd64";

export type NodeLevel5ProductSnapshotDirection = "arm64-to-amd64" | "amd64-to-arm64";
export type NodeLevel5ProductSnapshotRefusalCode =
  | "node-level5-non-node-target-refused"
  | "node-level5-target-app-root-missing"
  | "node-level5-unsupported-app-refused"
  | "node-level5-active-request-refused"
  | "node-level5-worker-thread-refused"
  | "node-level5-native-addon-refused"
  | "node-level5-wasm-external-memory-refused"
  | "node-level5-tls-active-state-refused"
  | "node-level5-child-process-live-state-refused"
  | "node-level5-filesystem-watcher-refused";

export type NodeLevel5ProductSnapshotRefusal = {
  code: NodeLevel5ProductSnapshotRefusalCode;
  message: string;
};

export type NodeLevel5ProductTargetIdentity = {
  kind: typeof NODE_LEVEL5_PRODUCT_TARGET_IDENTITY_KIND;
  target: string;
  targetKind: "pid" | "name" | "current-directory";
  runtime: "node" | "unknown";
  appDir?: string;
  pid?: number;
  registryMatched: boolean;
  accepted: boolean;
  refusal?: NodeLevel5ProductSnapshotRefusal;
};

export type NodeLevel5ProductDetectorReport = {
  kind: typeof NODE_LEVEL5_PRODUCT_DETECTOR_REPORT_KIND;
  accepted: boolean;
  appDir: string;
  familyId?: NodeLevel5ProductSupport80FamilyId;
  direction: NodeLevel5ProductSnapshotDirection;
  detectedFramework?: "express" | "fastify";
  refusal?: NodeLevel5ProductSnapshotRefusal;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5ProductSnapshotManifest = {
  kind: typeof NODE_LEVEL5_PRODUCT_SNAPSHOT_KIND;
  version: typeof NODE_LEVEL5_PRODUCT_SNAPSHOT_VERSION;
  status: "node-product-support-80";
  familyId: NodeLevel5ProductSupport80FamilyId;
  direction: NodeLevel5ProductSnapshotDirection;
  artifactRoot: string;
  detectorReportPath: "node-level5-detector-report.json";
  detectorReportSha256: string;
  targetIdentityPath: "node-level5-target-identity.json";
  targetIdentitySha256: string;
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
  manifestPath?: string;
  manifest?: NodeLevel5ProductSnapshotManifest;
  targetIdentity: NodeLevel5ProductTargetIdentity;
  detectorReport?: NodeLevel5ProductDetectorReport;
  refusal?: NodeLevel5ProductSnapshotRefusal;
};

export type NodeLevel5ProductRestoreSummary = {
  kind: "machinen.node-level5-product-restore-summary";
  accepted: boolean;
  snapshotDir: string;
  manifestPath: string;
  familyId: NodeLevel5ProductSupport80FamilyId;
  direction: NodeLevel5ProductSnapshotDirection;
  targetIdentityVerified: boolean;
  detectorReportVerified: boolean;
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
  appDir?: string;
  target?: Partial<NodeLevel5ProductTargetIdentity> & {
    target: string;
    targetKind: "pid" | "name";
  };
  direction?: NodeLevel5ProductSnapshotDirection;
}): NodeLevel5ProductSnapshotSummary {
  const targetIdentity = buildTargetIdentity(input);
  if (!targetIdentity.accepted || !targetIdentity.appDir) {
    return refusedSnapshot(input.outDir, targetIdentity, targetIdentity.refusal!);
  }
  const detectorReport = detectNodeLevel5ProductSnapshotApp({
    appDir: targetIdentity.appDir,
    direction: input.direction ?? DEFAULT_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION,
  });
  if (!detectorReport.accepted || !detectorReport.familyId) {
    return refusedSnapshot(input.outDir, targetIdentity, detectorReport.refusal!, detectorReport);
  }
  return writeAcceptedNodeLevel5ProductSnapshot(input.outDir, targetIdentity, {
    ...detectorReport,
    familyId: detectorReport.familyId,
  });
}

export function detectNodeLevel5ProductSnapshotApp(input: {
  appDir: string;
  direction?: NodeLevel5ProductSnapshotDirection;
}): NodeLevel5ProductDetectorReport {
  const direction = input.direction ?? DEFAULT_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION;
  const refusal = detectNodeLevel5ProductSnapshotRefusal(input.appDir);
  if (refusal) {
    return detectorReportBase(input.appDir, direction, { accepted: false, refusal });
  }
  const framework = detectSupportedFramework(input.appDir);
  if (!framework) {
    return detectorReportBase(input.appDir, direction, {
      accepted: false,
      refusal: {
        code: "node-level5-unsupported-app-refused",
        message: "Node Level 5 product snapshot did not detect a supported idle HTTP app",
      },
    });
  }
  return detectorReportBase(input.appDir, direction, {
    accepted: true,
    familyId: "express-fastify-http-app",
    detectedFramework: framework,
  });
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
  const manifest = readValidNodeLevel5ProductSnapshotManifest(input.snapshotDir);
  const targetIdentityVerified = verifyTargetIdentity(input.snapshotDir, manifest);
  const detectorReportVerified = verifyDetectorReport(input.snapshotDir, manifest);
  const verification = verifyRetainedArtifactBundle(input.snapshotDir, manifest);
  return {
    kind: "machinen.node-level5-product-restore-summary",
    accepted: verification.accepted && detectorReportVerified && targetIdentityVerified,
    snapshotDir: input.snapshotDir,
    manifestPath: manifestPathFor(input.snapshotDir),
    familyId: manifest.familyId,
    direction: manifest.direction,
    targetIdentityVerified,
    detectorReportVerified,
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

function buildTargetIdentity(input: {
  appDir?: string;
  target?: Partial<NodeLevel5ProductTargetIdentity> & {
    target: string;
    targetKind: "pid" | "name";
  };
}): NodeLevel5ProductTargetIdentity {
  if (!input.target) {
    return {
      kind: NODE_LEVEL5_PRODUCT_TARGET_IDENTITY_KIND,
      target: "current-directory",
      targetKind: "current-directory",
      runtime: "node",
      appDir: input.appDir ?? process.cwd(),
      registryMatched: false,
      accepted: true,
    };
  }
  const target = input.target;
  if (target.runtime !== "node") {
    return refusedTargetIdentity(target, "node-level5-non-node-target-refused");
  }
  if (!target.appDir) {
    return refusedTargetIdentity(target, "node-level5-target-app-root-missing");
  }
  return {
    kind: NODE_LEVEL5_PRODUCT_TARGET_IDENTITY_KIND,
    target: target.target,
    targetKind: target.targetKind,
    runtime: "node",
    appDir: target.appDir,
    pid: target.pid,
    registryMatched: target.registryMatched === true,
    accepted: true,
  };
}

function refusedTargetIdentity(
  target: Partial<NodeLevel5ProductTargetIdentity> & { target: string; targetKind: "pid" | "name" },
  code: NodeLevel5ProductSnapshotRefusalCode,
): NodeLevel5ProductTargetIdentity {
  return {
    kind: NODE_LEVEL5_PRODUCT_TARGET_IDENTITY_KIND,
    target: target.target,
    targetKind: target.targetKind,
    runtime: target.runtime ?? "unknown",
    appDir: target.appDir,
    pid: target.pid,
    registryMatched: target.registryMatched === true,
    accepted: false,
    refusal: { code, message: `${code} before Node Level 5 snapshot` },
  };
}

function refusedSnapshot(
  outDir: string,
  targetIdentity: NodeLevel5ProductTargetIdentity,
  refusal: NodeLevel5ProductSnapshotRefusal,
  detectorReport?: NodeLevel5ProductDetectorReport,
): NodeLevel5ProductSnapshotSummary {
  return {
    kind: "machinen.node-level5-product-snapshot-summary",
    accepted: false,
    snapshotDir: outDir,
    targetIdentity,
    detectorReport,
    refusal,
  };
}

function writeAcceptedNodeLevel5ProductSnapshot(
  outDir: string,
  targetIdentity: NodeLevel5ProductTargetIdentity,
  detectorReport: NodeLevel5ProductDetectorReport & {
    familyId: NodeLevel5ProductSupport80FamilyId;
  },
): NodeLevel5ProductSnapshotSummary {
  mkdirSync(outDir, { recursive: true });
  const targetIdentityPath = join(outDir, "node-level5-target-identity.json");
  const detectorReportPath = join(outDir, "node-level5-detector-report.json");
  writeFileSync(targetIdentityPath, `${JSON.stringify(targetIdentity, null, 2)}\n`);
  writeFileSync(detectorReportPath, `${JSON.stringify(detectorReport, null, 2)}\n`);
  const bundle = createNodeLevel5ProductSupport80ArtifactBundle({
    outDir: join(outDir, "artifacts"),
    familyId: detectorReport.familyId,
    direction: detectorReport.direction,
  });
  const manifestPath = join(outDir, "node-level5-product-snapshot.json");
  const manifest = buildManifest(
    detectorReport,
    bundle.kind,
    sha256File(detectorReportPath),
    sha256File(targetIdentityPath),
  );
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    kind: "machinen.node-level5-product-snapshot-summary",
    accepted: true,
    snapshotDir: outDir,
    manifestPath,
    manifest,
    targetIdentity,
    detectorReport,
  };
}

function buildManifest(
  report: NodeLevel5ProductDetectorReport & { familyId: NodeLevel5ProductSupport80FamilyId },
  artifactBundleKind: NodeLevel5ProductSnapshotManifest["artifactBundleKind"],
  detectorReportSha256: string,
  targetIdentitySha256: string,
): NodeLevel5ProductSnapshotManifest {
  return {
    kind: NODE_LEVEL5_PRODUCT_SNAPSHOT_KIND,
    version: NODE_LEVEL5_PRODUCT_SNAPSHOT_VERSION,
    status: "node-product-support-80",
    familyId: report.familyId,
    direction: report.direction,
    artifactRoot: join("artifacts", report.familyId, report.direction),
    detectorReportPath: "node-level5-detector-report.json",
    detectorReportSha256,
    targetIdentityPath: "node-level5-target-identity.json",
    targetIdentitySha256,
    artifactBundleKind,
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
}

function detectorReportBase(
  appDir: string,
  direction: NodeLevel5ProductSnapshotDirection,
  fields: Pick<NodeLevel5ProductDetectorReport, "accepted"> &
    Partial<Pick<NodeLevel5ProductDetectorReport, "familyId" | "detectedFramework" | "refusal">>,
): NodeLevel5ProductDetectorReport {
  return {
    kind: NODE_LEVEL5_PRODUCT_DETECTOR_REPORT_KIND,
    appDir,
    direction,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    ...fields,
  };
}

function detectSupportedFramework(appDir: string): "express" | "fastify" | undefined {
  const packageJson = readPackageJson(appDir);
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies } as Record<
    string,
    unknown
  >;
  if (typeof deps.express === "string") {
    return "express";
  }
  if (typeof deps.fastify === "string") {
    return "fastify";
  }
  return undefined;
}

function detectNodeLevel5ProductSnapshotRefusal(
  appDir: string,
): NodeLevel5ProductSnapshotRefusal | undefined {
  const markers = readDetectorMarkers(appDir);
  return (
    markerRefusal(markers.activeRequests, "node-level5-active-request-refused") ??
    markerRefusal(markers.workerThreads, "node-level5-worker-thread-refused") ??
    markerRefusal(markers.nativeAddons, "node-level5-native-addon-refused") ??
    markerRefusal(markers.wasmExternalMemory, "node-level5-wasm-external-memory-refused") ??
    markerRefusal(markers.tlsActiveState, "node-level5-tls-active-state-refused") ??
    markerRefusal(markers.childProcesses, "node-level5-child-process-live-state-refused") ??
    markerRefusal(markers.filesystemWatchers, "node-level5-filesystem-watcher-refused")
  );
}

function markerRefusal(
  present: unknown,
  code: NodeLevel5ProductSnapshotRefusalCode,
): NodeLevel5ProductSnapshotRefusal | undefined {
  return present === true ? { code, message: `${code} before Node Level 5 snapshot` } : undefined;
}

function readDetectorMarkers(appDir: string): Record<string, unknown> {
  const path = join(appDir, "machinen-node-level5-detector.json");
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function readPackageJson(appDir: string): Record<string, any> {
  const path = join(appDir, "package.json");
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
}

function readValidNodeLevel5ProductSnapshotManifest(
  snapshotDir: string,
): NodeLevel5ProductSnapshotManifest {
  const manifest = readNodeLevel5ProductSnapshotManifest(snapshotDir);
  if (!isNodeLevel5ProductSnapshotManifest(manifest)) {
    throw new Error("Node Level 5 product snapshot manifest is invalid");
  }
  return manifest;
}

function verifyTargetIdentity(
  snapshotDir: string,
  manifest: NodeLevel5ProductSnapshotManifest,
): boolean {
  const targetPath = join(snapshotDir, manifest.targetIdentityPath);
  if (sha256File(targetPath) !== manifest.targetIdentitySha256) {
    throw new Error("Node Level 5 product snapshot target identity hash mismatch");
  }
  const target = JSON.parse(readFileSync(targetPath, "utf8")) as NodeLevel5ProductTargetIdentity;
  return target.kind === NODE_LEVEL5_PRODUCT_TARGET_IDENTITY_KIND && target.accepted === true;
}

function verifyDetectorReport(
  snapshotDir: string,
  manifest: NodeLevel5ProductSnapshotManifest,
): boolean {
  const reportPath = join(snapshotDir, manifest.detectorReportPath);
  if (sha256File(reportPath) !== manifest.detectorReportSha256) {
    throw new Error("Node Level 5 product snapshot detector report hash mismatch");
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as NodeLevel5ProductDetectorReport;
  return report.kind === NODE_LEVEL5_PRODUCT_DETECTOR_REPORT_KIND && report.accepted === true;
}

function verifyRetainedArtifactBundle(
  snapshotDir: string,
  manifest: NodeLevel5ProductSnapshotManifest,
) {
  return verifyNodeLevel5ProductSupport80ArtifactBundle(
    loadNodeLevel5ProductSupport80ArtifactBundle({
      artifactRoot: join(snapshotDir, manifest.artifactRoot),
      familyId: manifest.familyId,
      direction: manifest.direction,
    }),
  );
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
    hasNodeLevel5ProductSnapshotEvidence(record) &&
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

function hasNodeLevel5ProductSnapshotEvidence(
  record: Partial<NodeLevel5ProductSnapshotManifest>,
): boolean {
  return (
    record.detectorReportPath === "node-level5-detector-report.json" &&
    typeof record.detectorReportSha256 === "string" &&
    record.targetIdentityPath === "node-level5-target-identity.json" &&
    typeof record.targetIdentitySha256 === "string"
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

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
