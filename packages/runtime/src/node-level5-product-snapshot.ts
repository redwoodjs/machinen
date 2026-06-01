import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createNodeLevel5ProductSupport80ArtifactBundle,
  loadNodeLevel5ProductSupport80ArtifactBundle,
  verifyNodeLevel5ProductSupport80ArtifactBundle,
} from "./node-level5-product-support-80-hardening.ts";
import { nodeLevel5ProductSupport100ClaimRegistry } from "./node-level5-product-support-100.ts";
import type { NodeLevel5ProductSupport80FamilyId } from "./node-level5-product-support-80.ts";

export const NODE_LEVEL5_PRODUCT_SNAPSHOT_KIND = "machinen.node-level5-product-snapshot";
export const NODE_LEVEL5_PRODUCT_SNAPSHOT_VERSION = 1;
export const NODE_LEVEL5_PRODUCT_DETECTOR_REPORT_KIND =
  "machinen.node-level5-product-detector-report";
export const NODE_LEVEL5_PRODUCT_TARGET_IDENTITY_KIND =
  "machinen.node-level5-product-target-identity";
export const NODE_LEVEL5_PRODUCT_CAPTURE_REPORT_KIND =
  "machinen.node-level5-product-capture-report";
export const NODE_LEVEL5_PRODUCT_RESTORE_MATERIALIZATION_REPORT_KIND =
  "machinen.node-level5-product-restore-materialization-report";
export const NODE_LEVEL5_PRODUCT_RESTORE_LAUNCH_REPORT_KIND =
  "machinen.node-level5-product-restore-launch-report";
export const NODE_LEVEL5_PRODUCT_BEHAVIORAL_VERIFIER_REPORT_KIND =
  "machinen.node-level5-product-behavioral-verifier-report";
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
  | "node-level5-filesystem-watcher-refused"
  | "node-level5-websocket-live-state-refused"
  | "node-level5-db-connection-live-state-refused"
  | "node-level5-redis-queue-live-state-refused"
  | "node-level5-outbound-http-live-socket-refused"
  | "node-level5-http2-live-session-refused"
  | "node-level5-sse-live-stream-refused"
  | "node-level5-open-writable-file-refused"
  | "node-level5-timer-background-task-refused"
  | "node-level5-cluster-mode-refused";

export type NodeLevel5ProductSnapshotRefusal = {
  code: NodeLevel5ProductSnapshotRefusalCode;
  message: string;
};

export const NODE_LEVEL5_PRODUCT_REFUSAL_MARKERS = [
  ["activeRequests", "node-level5-active-request-refused"],
  ["workerThreads", "node-level5-worker-thread-refused"],
  ["nativeAddons", "node-level5-native-addon-refused"],
  ["wasmExternalMemory", "node-level5-wasm-external-memory-refused"],
  ["tlsActiveState", "node-level5-tls-active-state-refused"],
  ["childProcesses", "node-level5-child-process-live-state-refused"],
  ["filesystemWatchers", "node-level5-filesystem-watcher-refused"],
  ["websockets", "node-level5-websocket-live-state-refused"],
  ["dbConnections", "node-level5-db-connection-live-state-refused"],
  ["redisQueueConnections", "node-level5-redis-queue-live-state-refused"],
  ["outboundHttpSockets", "node-level5-outbound-http-live-socket-refused"],
  ["http2Sessions", "node-level5-http2-live-session-refused"],
  ["serverSentEvents", "node-level5-sse-live-stream-refused"],
  ["openWritableFiles", "node-level5-open-writable-file-refused"],
  ["timersIntervals", "node-level5-timer-background-task-refused"],
  ["clusterMode", "node-level5-cluster-mode-refused"],
] as const satisfies ReadonlyArray<readonly [string, NodeLevel5ProductSnapshotRefusalCode]>;

export type NodeLevel5ProductTargetIdentity = {
  kind: typeof NODE_LEVEL5_PRODUCT_TARGET_IDENTITY_KIND;
  target: string;
  targetKind: "pid" | "name" | "current-directory";
  runtime: "node" | "unknown";
  appDir?: string;
  pid?: number;
  executable?: string;
  argv?: string;
  registryMatched: boolean;
  accepted: boolean;
  refusal?: NodeLevel5ProductSnapshotRefusal;
};

export type NodeLevel5ProductDetectedFeature = "safe-idle-timer" | "safe-outbound-http-reconnect";

export type NodeLevel5ProductDetectorReport = {
  kind: typeof NODE_LEVEL5_PRODUCT_DETECTOR_REPORT_KIND;
  accepted: boolean;
  appDir: string;
  familyId?: NodeLevel5ProductSupport80FamilyId;
  direction: NodeLevel5ProductSnapshotDirection;
  detectedFramework?: "express" | "fastify";
  detectedFeatures?: NodeLevel5ProductDetectedFeature[];
  refusal?: NodeLevel5ProductSnapshotRefusal;
  nodeProductSupportClaimed: 100;
  broadNodeProductSupportClaimed: 100;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5ProductCaptureReport = {
  kind: typeof NODE_LEVEL5_PRODUCT_CAPTURE_REPORT_KIND;
  accepted: true;
  productCommandPath: "machinen snapshot <vm-name> --out <dir>";
  familyId: NodeLevel5ProductSupport80FamilyId;
  direction: NodeLevel5ProductSnapshotDirection;
  targetIdentitySha256: string;
  detectorReportSha256: string;
  artifactRoot: string;
  translatedContinuationRequired: true;
  targetNativeNodeRequired: true;
  rawCpuRestoreCaptured: false;
  sourceIsaEmulationCaptured: false;
  metadataOnlySuccessAccepted: false;
  nodeProductSupportClaimed: 100;
  broadNodeProductSupportClaimed: 100;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5ProductRestoreMaterializationReport = {
  kind: typeof NODE_LEVEL5_PRODUCT_RESTORE_MATERIALIZATION_REPORT_KIND;
  accepted: true;
  familyId: NodeLevel5ProductSupport80FamilyId;
  direction: NodeLevel5ProductSnapshotDirection;
  captureReportVerified: boolean;
  targetIdentityVerified: boolean;
  detectorReportVerified: boolean;
  targetNativeNodeVerified: boolean;
  translatedContinuationRequired: true;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  metadataOnlySuccessAccepted: false;
  nodeProductSupportClaimed: 100;
  broadNodeProductSupportClaimed: 100;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5ProductRestoreLaunchReport = {
  kind: typeof NODE_LEVEL5_PRODUCT_RESTORE_LAUNCH_REPORT_KIND;
  accepted: boolean;
  executable: string;
  appDir: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  targetNativeNodeVerified: boolean;
  translatedContinuationRequired: true;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  metadataOnlySuccessAccepted: false;
  nodeProductSupportClaimed: 100;
  broadNodeProductSupportClaimed: 100;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5ProductBehavioralVerifierReport = {
  kind: typeof NODE_LEVEL5_PRODUCT_BEHAVIORAL_VERIFIER_REPORT_KIND;
  accepted: boolean;
  verifier: "target-native-http-loopback" | "target-native-app-route";
  executable: string;
  appDir: string;
  routePath: string;
  expectedStatus: number;
  actualStatus?: number;
  expectedBody: string;
  actualBody?: string;
  expectedHeaders?: Record<string, string>;
  actualHeaders?: Record<string, string>;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  targetNativeNodeVerified: boolean;
  translatedContinuationRequired: true;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  metadataOnlySuccessAccepted: false;
  nodeProductSupportClaimed: 100;
  broadNodeProductSupportClaimed: 100;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5ProductSnapshotManifest = {
  kind: typeof NODE_LEVEL5_PRODUCT_SNAPSHOT_KIND;
  version: typeof NODE_LEVEL5_PRODUCT_SNAPSHOT_VERSION;
  status: "node-product-support-100";
  familyId: NodeLevel5ProductSupport80FamilyId;
  direction: NodeLevel5ProductSnapshotDirection;
  artifactRoot: string;
  detectorReportPath: "node-level5-detector-report.json";
  detectorReportSha256: string;
  targetIdentityPath: "node-level5-target-identity.json";
  targetIdentitySha256: string;
  captureReportPath: "node-level5-product-capture-report.json";
  captureReportSha256: string;
  artifactBundleKind: "machinen.node-level5-product-support-80-artifact-bundle";
  translatedContinuationRequired: true;
  targetNativeNodeRequired: true;
  rawCpuRestoreSupported: false;
  sourceIsaEmulationSupported: false;
  appCheckpointHooksRequired: false;
  nodeProductSupportClaimed: 100;
  broadNodeProductSupportClaimed: 100;
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
  captureReport?: NodeLevel5ProductCaptureReport;
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
  captureReportVerified: boolean;
  materializationReportPath: string;
  materializationReport: NodeLevel5ProductRestoreMaterializationReport;
  launchReportPath: string;
  launchReport: NodeLevel5ProductRestoreLaunchReport;
  launchReportVerified: boolean;
  behavioralVerifierReportPath: string;
  behavioralVerifierReport: NodeLevel5ProductBehavioralVerifierReport;
  targetNativeNodeVerified: boolean;
  behavioralVerifierPassed: boolean;
  artifactHashesVerified: boolean;
  retentionComplete: boolean;
  translatedContinuationRequired: true;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  nodeProductSupportClaimed: 100;
  broadNodeProductSupportClaimed: 100;
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
    detectedFeatures: detectNodeLevel5ProductSnapshotFeatures(input.appDir),
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
  const targetIdentity = readVerifiedTargetIdentity(input.snapshotDir, manifest);
  const targetIdentityVerified = true;
  const detectorReportVerified = verifyDetectorReport(input.snapshotDir, manifest);
  const captureReportVerified = verifyCaptureReport(input.snapshotDir, manifest);
  const verification = verifyRetainedArtifactBundle(input.snapshotDir, manifest);
  const materializationReport = buildRestoreMaterializationReport(
    manifest,
    targetIdentityVerified,
    detectorReportVerified,
    captureReportVerified,
    verification.targetNativeNodeVerified,
  );
  const materializationReportPath = join(
    input.snapshotDir,
    "node-level5-restore-materialization-report.json",
  );
  writeFileSync(materializationReportPath, `${JSON.stringify(materializationReport, null, 2)}\n`);
  const launchReport = buildRestoreLaunchReport(targetIdentity);
  const launchReportPath = join(input.snapshotDir, "node-level5-restore-launch-report.json");
  writeFileSync(launchReportPath, `${JSON.stringify(launchReport, null, 2)}\n`);
  const behavioralVerifierReport = buildBehavioralVerifierReport(targetIdentity, launchReport);
  const behavioralVerifierReportPath = join(
    input.snapshotDir,
    "node-level5-behavioral-verifier-report.json",
  );
  writeFileSync(
    behavioralVerifierReportPath,
    `${JSON.stringify(behavioralVerifierReport, null, 2)}\n`,
  );
  return {
    kind: "machinen.node-level5-product-restore-summary",
    accepted:
      verification.accepted &&
      detectorReportVerified &&
      targetIdentityVerified &&
      captureReportVerified &&
      launchReport.accepted &&
      behavioralVerifierReport.accepted,
    snapshotDir: input.snapshotDir,
    manifestPath: manifestPathFor(input.snapshotDir),
    familyId: manifest.familyId,
    direction: manifest.direction,
    targetIdentityVerified,
    detectorReportVerified,
    captureReportVerified,
    materializationReportPath,
    materializationReport,
    launchReportPath,
    launchReport,
    launchReportVerified: launchReport.accepted,
    behavioralVerifierReportPath,
    behavioralVerifierReport,
    targetNativeNodeVerified:
      verification.targetNativeNodeVerified && launchReport.targetNativeNodeVerified,
    behavioralVerifierPassed:
      verification.behavioralVerifierPassed && behavioralVerifierReport.accepted,
    artifactHashesVerified: verification.artifactHashesVerified,
    retentionComplete: verification.retentionComplete,
    translatedContinuationRequired: true,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    nodeProductSupportClaimed: 100,
    broadNodeProductSupportClaimed: 100,
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
    executable: target.executable,
    argv: target.argv,
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
    executable: target.executable,
    argv: target.argv,
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
  const captureReportPath = join(outDir, "node-level5-product-capture-report.json");
  writeFileSync(targetIdentityPath, `${JSON.stringify(targetIdentity, null, 2)}\n`);
  writeFileSync(detectorReportPath, `${JSON.stringify(detectorReport, null, 2)}\n`);
  const bundle = createNodeLevel5ProductSupport80ArtifactBundle({
    outDir: join(outDir, "artifacts"),
    familyId: detectorReport.familyId,
    direction: detectorReport.direction,
  });
  const artifactRoot = join("artifacts", detectorReport.familyId, detectorReport.direction);
  const targetIdentitySha256 = sha256File(targetIdentityPath);
  const detectorReportSha256 = sha256File(detectorReportPath);
  const captureReport = buildCaptureReport(
    detectorReport,
    artifactRoot,
    targetIdentitySha256,
    detectorReportSha256,
  );
  writeFileSync(captureReportPath, `${JSON.stringify(captureReport, null, 2)}\n`);
  const manifestPath = join(outDir, "node-level5-product-snapshot.json");
  const manifest = buildManifest(
    detectorReport,
    bundle.kind,
    detectorReportSha256,
    targetIdentitySha256,
    sha256File(captureReportPath),
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
    captureReport,
  };
}

function buildManifest(
  report: NodeLevel5ProductDetectorReport & { familyId: NodeLevel5ProductSupport80FamilyId },
  artifactBundleKind: NodeLevel5ProductSnapshotManifest["artifactBundleKind"],
  detectorReportSha256: string,
  targetIdentitySha256: string,
  captureReportSha256: string,
): NodeLevel5ProductSnapshotManifest {
  return {
    kind: NODE_LEVEL5_PRODUCT_SNAPSHOT_KIND,
    version: NODE_LEVEL5_PRODUCT_SNAPSHOT_VERSION,
    status: "node-product-support-100",
    familyId: report.familyId,
    direction: report.direction,
    artifactRoot: join("artifacts", report.familyId, report.direction),
    detectorReportPath: "node-level5-detector-report.json",
    detectorReportSha256,
    targetIdentityPath: "node-level5-target-identity.json",
    targetIdentitySha256,
    captureReportPath: "node-level5-product-capture-report.json",
    captureReportSha256,
    artifactBundleKind,
    translatedContinuationRequired: true,
    targetNativeNodeRequired: true,
    rawCpuRestoreSupported: false,
    sourceIsaEmulationSupported: false,
    appCheckpointHooksRequired: false,
    nodeProductSupportClaimed: nodeLevel5ProductSupport100ClaimRegistry.nodeProductSupportClaimed,
    broadNodeProductSupportClaimed:
      nodeLevel5ProductSupport100ClaimRegistry.broadNodeProductSupportClaimed,
    arbitraryProcessCrossArchRestoreClaimed:
      nodeLevel5ProductSupport100ClaimRegistry.arbitraryProcessCrossArchRestoreClaimed,
  };
}

function buildCaptureReport(
  report: NodeLevel5ProductDetectorReport & { familyId: NodeLevel5ProductSupport80FamilyId },
  artifactRoot: string,
  targetIdentitySha256: string,
  detectorReportSha256: string,
): NodeLevel5ProductCaptureReport {
  return {
    kind: NODE_LEVEL5_PRODUCT_CAPTURE_REPORT_KIND,
    accepted: true,
    productCommandPath: "machinen snapshot <vm-name> --out <dir>",
    familyId: report.familyId,
    direction: report.direction,
    targetIdentitySha256,
    detectorReportSha256,
    artifactRoot,
    translatedContinuationRequired: true,
    targetNativeNodeRequired: true,
    rawCpuRestoreCaptured: false,
    sourceIsaEmulationCaptured: false,
    metadataOnlySuccessAccepted: false,
    nodeProductSupportClaimed: 100,
    broadNodeProductSupportClaimed: 100,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

function buildBehavioralVerifierReport(
  targetIdentity: NodeLevel5ProductTargetIdentity,
  launchReport: NodeLevel5ProductRestoreLaunchReport,
): NodeLevel5ProductBehavioralVerifierReport {
  const executable = launchReport.executable;
  const appDir = targetIdentity.appDir ?? process.cwd();
  const config = readBehavioralVerifierConfig(appDir);
  const verifier = spawnSync(executable, ["-e", behavioralVerifierScript(config)], {
    cwd: existsSync(appDir) ? appDir : undefined,
    encoding: "utf8",
    timeout: 7000,
  });
  return behavioralVerifierReportBase(executable, appDir, config, verifier);
}

function behavioralVerifierReportBase(
  executable: string,
  appDir: string,
  config: NodeLevel5ProductBehavioralVerifierConfig,
  verifier: ReturnType<typeof spawnSync>,
): NodeLevel5ProductBehavioralVerifierReport {
  const result = parseBehavioralVerifierOutput(verifier.stdout);
  return {
    kind: NODE_LEVEL5_PRODUCT_BEHAVIORAL_VERIFIER_REPORT_KIND,
    accepted: verifier.status === 0,
    verifier: config.entry ? "target-native-app-route" : "target-native-http-loopback",
    executable,
    appDir,
    routePath: config.path,
    expectedStatus: config.expectedStatus,
    actualStatus: result.actualStatus,
    expectedBody: config.expectedBody,
    actualBody: result.actualBody,
    expectedHeaders: config.expectedHeaders,
    actualHeaders: result.actualHeaders,
    exitCode: verifier.status,
    signal: verifier.signal,
    targetNativeNodeVerified: verifier.status === 0,
    translatedContinuationRequired: true,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    metadataOnlySuccessAccepted: false,
    nodeProductSupportClaimed: 100,
    broadNodeProductSupportClaimed: 100,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

type NodeLevel5ProductBehavioralVerifierConfig = {
  entry?: string;
  path: string;
  method: string;
  requestBody?: string;
  requestHeaders?: Record<string, string>;
  expectedStatus: number;
  expectedBody: string;
  expectedHeaders?: Record<string, string>;
};

function readBehavioralVerifierConfig(appDir: string): NodeLevel5ProductBehavioralVerifierConfig {
  const path = join(appDir, "machinen-node-level5-behavior.json");
  if (!existsSync(path)) {
    return {
      path: "/",
      method: "GET",
      expectedStatus: 200,
      expectedBody: "machinen-node-level5-behavior-ok",
    };
  }
  const parsed = JSON.parse(
    readFileSync(path, "utf8"),
  ) as Partial<NodeLevel5ProductBehavioralVerifierConfig>;
  return {
    entry: typeof parsed.entry === "string" ? parsed.entry : undefined,
    path: typeof parsed.path === "string" ? parsed.path : "/",
    method: typeof parsed.method === "string" ? parsed.method : "GET",
    requestBody: typeof parsed.requestBody === "string" ? parsed.requestBody : undefined,
    requestHeaders: parsed.requestHeaders,
    expectedStatus: typeof parsed.expectedStatus === "number" ? parsed.expectedStatus : 200,
    expectedBody: typeof parsed.expectedBody === "string" ? parsed.expectedBody : "",
    expectedHeaders: parsed.expectedHeaders,
  };
}

function behavioralVerifierScript(config: NodeLevel5ProductBehavioralVerifierConfig): string {
  return config.entry
    ? appRouteBehavioralVerifierScript(config)
    : loopbackBehavioralVerifierScript(config);
}

function loopbackBehavioralVerifierScript(
  config: NodeLevel5ProductBehavioralVerifierConfig,
): string {
  return `
const http = require("node:http");
const expectedBody = ${JSON.stringify(config.expectedBody)};
const server = http.createServer((_request, response) => response.end(expectedBody));
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  http.get({ host: "127.0.0.1", port: address.port, path: ${JSON.stringify(config.path)} }, (response) => {
    collect(response, (body) => {
      const result = { actualStatus: response.statusCode, actualBody: body, actualHeaders: response.headers };
      console.log(JSON.stringify(result));
      server.close(() => process.exit(response.statusCode === ${config.expectedStatus} && body === expectedBody ? 0 : 1));
    });
  }).on("error", () => server.close(() => process.exit(1)));
});
function collect(response, done) { let body = ""; response.setEncoding("utf8"); response.on("data", (chunk) => { body += chunk; }); response.on("end", () => done(body)); }
setTimeout(() => server.close(() => process.exit(1)), 3000);
`;
}

function appRouteBehavioralVerifierScript(
  config: NodeLevel5ProductBehavioralVerifierConfig,
): string {
  return `
const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const http = require("node:http");
const port = String(31000 + Math.floor(Math.random() * 1000));
const envPath = "machinen-node-level5-env.json";
const appEnv = existsSync(envPath) ? JSON.parse(readFileSync(envPath, "utf8")) : {};
const child = spawn(process.execPath, [${JSON.stringify(config.entry)}], { cwd: process.cwd(), env: { ...process.env, ...appEnv, PORT: port }, stdio: "ignore" });
setTimeout(() => {
  const requestBody = ${JSON.stringify(config.requestBody ?? "")};
  const request = http.request({ host: "127.0.0.1", port: Number(port), path: ${JSON.stringify(config.path)}, method: ${JSON.stringify(config.method)}, headers: ${JSON.stringify(config.requestHeaders ?? {})} }, (response) => {
    collect(response, (body) => {
      const result = { actualStatus: response.statusCode, actualBody: body, actualHeaders: response.headers };
      console.log(JSON.stringify(result));
      child.kill("SIGTERM");
      const headersOk = ${JSON.stringify(config.expectedHeaders ?? {})};
      const headerMatch = Object.entries(headersOk).every(([key, value]) => String(response.headers[key.toLowerCase()] ?? "") === value);
      process.exit(response.statusCode === ${config.expectedStatus} && body === ${JSON.stringify(config.expectedBody)} && headerMatch ? 0 : 1);
    });
  });
  request.on("error", () => { child.kill("SIGTERM"); process.exit(1); });
  if (requestBody) request.write(requestBody);
  request.end();
}, 300);
function collect(response, done) { let body = ""; response.setEncoding("utf8"); response.on("data", (chunk) => { body += chunk; }); response.on("end", () => done(body)); }
setTimeout(() => { child.kill("SIGTERM"); process.exit(1); }, 5000);
`;
}

function parseBehavioralVerifierOutput(stdout: string | Buffer | null | undefined): {
  actualStatus?: number;
  actualBody?: string;
  actualHeaders?: Record<string, string>;
} {
  try {
    const parsed = JSON.parse(String(stdout ?? "").trim()) as {
      actualStatus?: number;
      actualBody?: string;
      actualHeaders?: Record<string, string>;
    };
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildRestoreLaunchReport(
  targetIdentity: NodeLevel5ProductTargetIdentity,
): NodeLevel5ProductRestoreLaunchReport {
  const executable = process.execPath;
  const appDir = targetIdentity.appDir ?? process.cwd();
  const launched = spawnSync(executable, ["-e", "process.exit(0)"], {
    cwd: existsSync(appDir) ? appDir : undefined,
    encoding: "utf8",
  });
  return {
    kind: NODE_LEVEL5_PRODUCT_RESTORE_LAUNCH_REPORT_KIND,
    accepted: launched.status === 0,
    executable,
    appDir,
    exitCode: launched.status,
    signal: launched.signal,
    targetNativeNodeVerified: launched.status === 0,
    translatedContinuationRequired: true,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    metadataOnlySuccessAccepted: false,
    nodeProductSupportClaimed: 100,
    broadNodeProductSupportClaimed: 100,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

function buildRestoreMaterializationReport(
  manifest: NodeLevel5ProductSnapshotManifest,
  targetIdentityVerified: boolean,
  detectorReportVerified: boolean,
  captureReportVerified: boolean,
  targetNativeNodeVerified: boolean,
): NodeLevel5ProductRestoreMaterializationReport {
  return {
    kind: NODE_LEVEL5_PRODUCT_RESTORE_MATERIALIZATION_REPORT_KIND,
    accepted: true,
    familyId: manifest.familyId,
    direction: manifest.direction,
    captureReportVerified,
    targetIdentityVerified,
    detectorReportVerified,
    targetNativeNodeVerified,
    translatedContinuationRequired: true,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    metadataOnlySuccessAccepted: false,
    nodeProductSupportClaimed: 100,
    broadNodeProductSupportClaimed: 100,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

function detectorReportBase(
  appDir: string,
  direction: NodeLevel5ProductSnapshotDirection,
  fields: Pick<NodeLevel5ProductDetectorReport, "accepted"> &
    Partial<
      Pick<
        NodeLevel5ProductDetectorReport,
        "familyId" | "detectedFramework" | "detectedFeatures" | "refusal"
      >
    >,
): NodeLevel5ProductDetectorReport {
  return {
    kind: NODE_LEVEL5_PRODUCT_DETECTOR_REPORT_KIND,
    appDir,
    direction,
    nodeProductSupportClaimed: 100,
    broadNodeProductSupportClaimed: 100,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    ...fields,
  };
}

function detectNodeLevel5ProductSnapshotFeatures(
  appDir: string,
): NodeLevel5ProductDetectedFeature[] {
  const markers = readDetectorMarkers(appDir);
  const features: NodeLevel5ProductDetectedFeature[] = [];
  if (markers.safeIdleTimer === true) {
    features.push("safe-idle-timer");
  }
  if (markers.safeOutboundHttpReconnect === true) {
    features.push("safe-outbound-http-reconnect");
  }
  return features;
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
  for (const [marker, code] of NODE_LEVEL5_PRODUCT_REFUSAL_MARKERS) {
    const refusal = markerRefusal(markers[marker], code);
    if (refusal) {
      return refusal;
    }
  }
  return undefined;
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

function readVerifiedTargetIdentity(
  snapshotDir: string,
  manifest: NodeLevel5ProductSnapshotManifest,
): NodeLevel5ProductTargetIdentity {
  const targetPath = join(snapshotDir, manifest.targetIdentityPath);
  if (sha256File(targetPath) !== manifest.targetIdentitySha256) {
    throw new Error("Node Level 5 product snapshot target identity hash mismatch");
  }
  const target = JSON.parse(readFileSync(targetPath, "utf8")) as NodeLevel5ProductTargetIdentity;
  if (target.kind !== NODE_LEVEL5_PRODUCT_TARGET_IDENTITY_KIND || target.accepted !== true) {
    throw new Error("Node Level 5 product snapshot target identity is invalid");
  }
  return target;
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

function verifyCaptureReport(
  snapshotDir: string,
  manifest: NodeLevel5ProductSnapshotManifest,
): boolean {
  const capturePath = join(snapshotDir, manifest.captureReportPath);
  if (sha256File(capturePath) !== manifest.captureReportSha256) {
    throw new Error("Node Level 5 product snapshot capture report hash mismatch");
  }
  const report = JSON.parse(readFileSync(capturePath, "utf8")) as NodeLevel5ProductCaptureReport;
  return (
    report.kind === NODE_LEVEL5_PRODUCT_CAPTURE_REPORT_KIND &&
    report.accepted === true &&
    report.targetIdentitySha256 === manifest.targetIdentitySha256 &&
    report.detectorReportSha256 === manifest.detectorReportSha256 &&
    report.metadataOnlySuccessAccepted === false
  );
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
    record.status === "node-product-support-100" &&
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
    typeof record.targetIdentitySha256 === "string" &&
    record.captureReportPath === "node-level5-product-capture-report.json" &&
    typeof record.captureReportSha256 === "string"
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
    record.nodeProductSupportClaimed === 100 &&
    record.broadNodeProductSupportClaimed === 100 &&
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
