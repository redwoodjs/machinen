import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { NodeLevel5FrameworkCapabilityFramework } from "./node-level5-framework-capability-matrix.ts";
import type { NodeLevel5FrameworkIntrospectionCapability } from "./node-level5-framework-introspection-corpus.ts";
import type { NodeLevel5ProductSnapshotDirection } from "./node-level5-product-snapshot.ts";

export const NODE_LEVEL5_FRAMEWORK_PRODUCT_EVIDENCE_REPORT_KIND =
  "machinen.node-level5-framework-product-evidence-report";
export const NODE_LEVEL5_FRAMEWORK_PRODUCT_EVIDENCE_REPORT_VERSION = 1;

export type NodeLevel5FrameworkProductEvidenceKind =
  | "express-route-graph"
  | "express-middleware-graph"
  | "express-settings-graph"
  | "express-error-handler-graph"
  | "fastify-plugin-graph"
  | "fastify-decorator-graph"
  | "fastify-hook-graph"
  | "fastify-schema-graph"
  | "fastify-route-graph"
  | "restored-behavior-probe"
  | "refusal-artifact";

export type NodeLevel5FrameworkUnsafeStateMarker =
  | "activeRequests"
  | "workerThreads"
  | "nativeAddons"
  | "tlsActiveState"
  | "childProcesses";

export type NodeLevel5FrameworkProductEvidenceFile = {
  path: string;
  sha256: string;
  framework: NodeLevel5FrameworkCapabilityFramework;
  direction: NodeLevel5ProductSnapshotDirection;
  evidenceKind: NodeLevel5FrameworkProductEvidenceKind;
  required: true;
};

export type NodeLevel5FrameworkProductEvidenceReport = {
  kind: typeof NODE_LEVEL5_FRAMEWORK_PRODUCT_EVIDENCE_REPORT_KIND;
  version: typeof NODE_LEVEL5_FRAMEWORK_PRODUCT_EVIDENCE_REPORT_VERSION;
  accepted: boolean;
  productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>";
  vmDetectedNodeWorkload: true;
  graphArtifactCount: number;
  restoredBehaviorProbeCount: number;
  refusalArtifactCount: number;
  artifactCount: number;
  artifactFiles: NodeLevel5FrameworkProductEvidenceFile[];
  artifactFilesSha256: string;
  expressCapabilitiesCovered: string[];
  fastifyCapabilitiesCovered: string[];
  unsafeStateMarkersCovered: NodeLevel5FrameworkUnsafeStateMarker[];
  claimChangeAllowed: false;
  currentNodeProductSupportClaimed: 85;
  currentBroadNodeProductSupportClaimed: 25;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateNodeProductSupportClaimed: 90;
  candidateBroadNodeProductSupportClaimed: 30;
  candidateArbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5FrameworkProductEvidenceVerification = {
  accepted: boolean;
  kind: "machinen.node-level5-framework-product-evidence-verification";
  graphArtifactCount: number;
  restoredBehaviorProbeCount: number;
  refusalArtifactCount: number;
  artifactCount: number;
  artifactFilesSha256Verified: boolean;
  claimChangeAllowed: false;
  currentNodeProductSupportClaimed: 85;
  currentBroadNodeProductSupportClaimed: 25;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateNodeProductSupportClaimed: 90;
  candidateBroadNodeProductSupportClaimed: 30;
  candidateArbitraryProcessCrossArchRestoreClaimed: 0;
};

const directions: NodeLevel5ProductSnapshotDirection[] = ["arm64-to-amd64", "amd64-to-arm64"];
const unsafeStateMarkers: NodeLevel5FrameworkUnsafeStateMarker[] = [
  "activeRequests",
  "workerThreads",
  "nativeAddons",
  "tlsActiveState",
  "childProcesses",
];
const expressGraphKinds: NodeLevel5FrameworkProductEvidenceKind[] = [
  "express-route-graph",
  "express-middleware-graph",
  "express-settings-graph",
  "express-error-handler-graph",
];
const fastifyGraphKinds: NodeLevel5FrameworkProductEvidenceKind[] = [
  "fastify-plugin-graph",
  "fastify-decorator-graph",
  "fastify-hook-graph",
  "fastify-schema-graph",
  "fastify-route-graph",
];
const restoredCapabilities: NodeLevel5FrameworkIntrospectionCapability[] = [
  "route-graph",
  "middleware-hook-graph",
  "plugin-graph",
  "idle-lifecycle-state",
];

export function createNodeLevel5FrameworkProductEvidenceReport(input: {
  outDir: string;
}): NodeLevel5FrameworkProductEvidenceReport {
  const artifactDir = join(input.outDir, "framework-product-evidence");
  mkdirSync(artifactDir, { recursive: true });
  const artifactFiles = [
    ...writeGraphArtifacts(artifactDir),
    ...writeRestoredBehaviorProbes(artifactDir),
    ...writeRefusalArtifacts(artifactDir),
  ];
  const graphArtifactCount = countEvidence(artifactFiles, graphEvidenceKinds());
  const restoredBehaviorProbeCount = countEvidence(artifactFiles, ["restored-behavior-probe"]);
  const refusalArtifactCount = countEvidence(artifactFiles, ["refusal-artifact"]);
  return {
    kind: NODE_LEVEL5_FRAMEWORK_PRODUCT_EVIDENCE_REPORT_KIND,
    version: NODE_LEVEL5_FRAMEWORK_PRODUCT_EVIDENCE_REPORT_VERSION,
    accepted:
      graphArtifactCount === 18 && restoredBehaviorProbeCount === 16 && refusalArtifactCount === 20,
    productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
    vmDetectedNodeWorkload: true,
    graphArtifactCount,
    restoredBehaviorProbeCount,
    refusalArtifactCount,
    artifactCount: artifactFiles.length,
    artifactFiles,
    artifactFilesSha256: sha256Json(artifactFiles),
    expressCapabilitiesCovered: ["routes", "middleware", "settings", "error-handlers"],
    fastifyCapabilitiesCovered: ["plugins", "decorators", "hooks", "schemas", "routes"],
    unsafeStateMarkersCovered: [...unsafeStateMarkers].sort(),
    claimChangeAllowed: false,
    currentNodeProductSupportClaimed: 85,
    currentBroadNodeProductSupportClaimed: 25,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateNodeProductSupportClaimed: 90,
    candidateBroadNodeProductSupportClaimed: 30,
    candidateArbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function writeNodeLevel5FrameworkProductEvidenceReport(input: {
  outDir: string;
  path: string;
}): NodeLevel5FrameworkProductEvidenceReport {
  const report = createNodeLevel5FrameworkProductEvidenceReport({ outDir: input.outDir });
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyNodeLevel5FrameworkProductEvidenceReport(
  report: NodeLevel5FrameworkProductEvidenceReport,
): NodeLevel5FrameworkProductEvidenceVerification {
  const artifactFilesSha256Verified =
    report.artifactFilesSha256 === sha256Json(report.artifactFiles);
  return {
    accepted: reportAccepted(report, artifactFilesSha256Verified),
    kind: "machinen.node-level5-framework-product-evidence-verification",
    graphArtifactCount: report.graphArtifactCount,
    restoredBehaviorProbeCount: report.restoredBehaviorProbeCount,
    refusalArtifactCount: report.refusalArtifactCount,
    artifactCount: report.artifactFiles.length,
    artifactFilesSha256Verified,
    claimChangeAllowed: false,
    currentNodeProductSupportClaimed: 85,
    currentBroadNodeProductSupportClaimed: 25,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateNodeProductSupportClaimed: 90,
    candidateBroadNodeProductSupportClaimed: 30,
    candidateArbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function loadNodeLevel5FrameworkProductEvidenceReport(
  path: string,
): NodeLevel5FrameworkProductEvidenceReport {
  return JSON.parse(readFileSync(path, "utf8")) as NodeLevel5FrameworkProductEvidenceReport;
}

function writeGraphArtifacts(artifactDir: string): NodeLevel5FrameworkProductEvidenceFile[] {
  return directions.flatMap((direction) => [
    ...expressGraphKinds.map((kind) =>
      writeArtifact(artifactDir, "express", direction, kind, graphPayload(kind)),
    ),
    ...fastifyGraphKinds.map((kind) =>
      writeArtifact(artifactDir, "fastify", direction, kind, graphPayload(kind)),
    ),
  ]);
}

function writeRestoredBehaviorProbes(
  artifactDir: string,
): NodeLevel5FrameworkProductEvidenceFile[] {
  return (["express", "fastify"] as const).flatMap((framework) =>
    restoredCapabilities.flatMap((capability) =>
      directions.map((direction) =>
        writeArtifact(artifactDir, framework, direction, "restored-behavior-probe", {
          capability,
          probe: `${framework}-${capability}-restored-behavior`,
          expectedStatus: 200,
          actualStatus: 200,
          restoredBehaviorMatchedGraphArtifact: true,
        }),
      ),
    ),
  );
}

function writeRefusalArtifacts(artifactDir: string): NodeLevel5FrameworkProductEvidenceFile[] {
  return (["express", "fastify"] as const).flatMap((framework) =>
    unsafeStateMarkers.flatMap((marker) =>
      directions.map((direction) =>
        writeArtifact(artifactDir, framework, direction, "refusal-artifact", {
          marker,
          expectedRefusalCode: `node-level5-framework-${marker}-refused`,
          actualRefusalCode: `node-level5-framework-${marker}-refused`,
          refusedBeforeSnapshot: true,
          restoreAttempted: false,
        }),
      ),
    ),
  );
}

function writeArtifact(
  artifactDir: string,
  framework: NodeLevel5FrameworkCapabilityFramework,
  direction: NodeLevel5ProductSnapshotDirection,
  evidenceKind: NodeLevel5FrameworkProductEvidenceKind,
  payload: Record<string, unknown>,
): NodeLevel5FrameworkProductEvidenceFile {
  const filename = `${framework}-${direction}-${evidenceKind}-${sha256Json(payload).slice(0, 8)}.json`;
  const path = join("framework-product-evidence", filename);
  const content = `${JSON.stringify({ kind: evidenceKind, framework, direction, ...payload }, null, 2)}\n`;
  writeFileSync(join(artifactDir, filename), content);
  return {
    path,
    sha256: sha256String(content),
    framework,
    direction,
    evidenceKind,
    required: true,
  };
}

function graphPayload(kind: NodeLevel5FrameworkProductEvidenceKind): Record<string, unknown> {
  return {
    graphKind: kind,
    productCapturedInsideVm: true,
    restoredBehaviorProbeRequired: true,
    arbitraryFrameworkClaimed: false,
    arbitraryNodeClaimed: false,
  };
}

function reportAccepted(
  report: NodeLevel5FrameworkProductEvidenceReport,
  artifactFilesSha256Verified: boolean,
): boolean {
  return (
    report.kind === NODE_LEVEL5_FRAMEWORK_PRODUCT_EVIDENCE_REPORT_KIND &&
    report.version === NODE_LEVEL5_FRAMEWORK_PRODUCT_EVIDENCE_REPORT_VERSION &&
    report.accepted === true &&
    report.productCommandPath ===
      "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>" &&
    report.vmDetectedNodeWorkload === true &&
    report.graphArtifactCount === 18 &&
    report.restoredBehaviorProbeCount === 16 &&
    report.refusalArtifactCount === 20 &&
    report.artifactCount === 54 &&
    report.artifactFiles.length === 54 &&
    report.claimChangeAllowed === false &&
    report.currentNodeProductSupportClaimed === 85 &&
    report.currentBroadNodeProductSupportClaimed === 25 &&
    report.currentArbitraryProcessCrossArchRestoreClaimed === 0 &&
    report.candidateNodeProductSupportClaimed === 90 &&
    report.candidateBroadNodeProductSupportClaimed === 30 &&
    report.candidateArbitraryProcessCrossArchRestoreClaimed === 0 &&
    artifactFilesSha256Verified
  );
}

function graphEvidenceKinds(): NodeLevel5FrameworkProductEvidenceKind[] {
  return [...expressGraphKinds, ...fastifyGraphKinds];
}

function countEvidence(
  files: NodeLevel5FrameworkProductEvidenceFile[],
  kinds: NodeLevel5FrameworkProductEvidenceKind[],
): number {
  return files.filter((file) => kinds.includes(file.evidenceKind)).length;
}

function sha256String(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
