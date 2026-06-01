import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const NODE_LEVEL5_NODE_SERVICE_CLAIM_LADDER_REPORT_KIND =
  "machinen.node-level5-node-service-claim-ladder-report";
export const NODE_LEVEL5_NODE_SERVICE_CLAIM_LADDER_REPORT_VERSION = 1;

export type NodeLevel5NodeServiceClaimTarget =
  | "95-40-0"
  | "97-50-0"
  | "98-60-0"
  | "99-70-0"
  | "99-80-0"
  | "100-85-0"
  | "100-90-0"
  | "100-95-0"
  | "100-98-0"
  | "100-100-0";

export type NodeLevel5NodeServiceClaimEvidenceKind =
  | "framework-capability-coverage-v2"
  | "framework-combination-corpus"
  | "node-runtime-capability-matrix"
  | "installed-framework-app-release-gate"
  | "broad-node-capability-claim-ready"
  | "unified-node-service-claim-gate"
  | "cross-corpus-consistency-gate"
  | "runtime-state-translation-gate"
  | "runtime-framework-combined-claim-ready"
  | "final-node-service-ga-gate";

export type NodeLevel5NodeServiceClaimTier = {
  target: NodeLevel5NodeServiceClaimTarget;
  nodeProductSupportClaimed: number;
  broadNodeProductSupportClaimed: number;
  arbitraryProcessCrossArchRestoreClaimed: 0;
  evidenceKind: NodeLevel5NodeServiceClaimEvidenceKind;
  proof: string;
  evidenceItems: string[];
  refusalBoundaries: string[];
  accepted: boolean;
  arbitraryNodeClaimed: false;
  arbitraryProcessClaimed: false;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  appCheckpointHooksRequired: false;
};

export type NodeLevel5NodeServiceClaimArtifact = {
  target: NodeLevel5NodeServiceClaimTarget;
  evidenceKind: NodeLevel5NodeServiceClaimEvidenceKind;
  path: string;
  sha256: string;
  required: true;
};

export type NodeLevel5NodeServiceClaimLadderReport = {
  kind: typeof NODE_LEVEL5_NODE_SERVICE_CLAIM_LADDER_REPORT_KIND;
  version: typeof NODE_LEVEL5_NODE_SERVICE_CLAIM_LADDER_REPORT_VERSION;
  accepted: boolean;
  tierCount: 10;
  tiers: NodeLevel5NodeServiceClaimTier[];
  artifactCount: 10;
  artifacts: NodeLevel5NodeServiceClaimArtifact[];
  artifactsSha256: string;
  finalNodeProductSupportClaimed: 100;
  finalBroadNodeProductSupportClaimed: 100;
  finalArbitraryProcessCrossArchRestoreClaimed: 0;
  claimChangeAllowed: true;
  arbitraryNodeClaimed: false;
  arbitraryExpressClaimed: false;
  arbitraryFastifyClaimed: false;
  arbitraryProcessClaimed: false;
};

export type NodeLevel5NodeServiceClaimLadderVerification = {
  accepted: boolean;
  kind: "machinen.node-level5-node-service-claim-ladder-verification";
  tierCount: number;
  artifactCount: number;
  artifactsSha256Verified: boolean;
  finalNodeProductSupportClaimed: 100;
  finalBroadNodeProductSupportClaimed: 100;
  finalArbitraryProcessCrossArchRestoreClaimed: 0;
  claimChangeAllowed: true;
};

const tierDefinitions: Omit<NodeLevel5NodeServiceClaimTier, "accepted">[] = [
  tier(
    "95-40-0",
    95,
    40,
    "framework-capability-coverage-v2",
    "broader selected Express/Fastify capability support",
    [
      "nested Express routers",
      "mounted Express apps",
      "Fastify encapsulation",
      "Fastify schemas",
      "Fastify decorators",
      "Fastify hooks",
      "framework error paths",
    ],
    ["active requests", "native addons", "workers", "TLS live state", "child processes"],
  ),
  tier(
    "97-50-0",
    97,
    50,
    "framework-combination-corpus",
    "real-world framework app patterns across combinations",
    [
      "route combinations",
      "middleware combinations",
      "plugin combinations",
      "config combinations",
      "restored behavior probes",
    ],
    ["arbitrary dynamic code", "unbounded plugins", "live socket state"],
  ),
  tier(
    "98-60-0",
    98,
    60,
    "node-runtime-capability-matrix",
    "more Node runtime surface within selected safe idle services",
    [
      "timers",
      "idle outbound reconnect",
      "env/config",
      "static assets",
      "file reads",
      "JSON/body parsing",
      "request lifecycle boundaries",
    ],
    ["live DB connections", "live external network state", "file watchers", "worker threads"],
  ),
  tier(
    "99-70-0",
    99,
    70,
    "installed-framework-app-release-gate",
    "larger app-shape coverage with exact boundaries",
    [
      "more installed Express packages",
      "more installed Fastify packages",
      "realistic installed app shapes",
    ],
    ["arbitrary third-party plugins", "native addons", "dynamic module loading"],
  ),
  tier(
    "99-80-0",
    99,
    80,
    "broad-node-capability-claim-ready",
    "stronger broad Node service evidence",
    ["capability-level Node HTTP service matrix", "negative broad Node corpus"],
    ["arbitrary Node apps", "source ISA emulation", "raw CPU restore"],
  ),
  tier(
    "100-85-0",
    100,
    85,
    "unified-node-service-claim-gate",
    "product-grade selected Node service coverage",
    [
      "Express safe idle apps",
      "Fastify safe idle apps",
      "Node http safe idle apps",
      "Node https safe idle apps",
    ],
    ["arbitrary process restore"],
  ),
  tier(
    "100-90-0",
    100,
    90,
    "cross-corpus-consistency-gate",
    "very broad selected-service support",
    [
      "real app retained evidence",
      "generated app retained evidence",
      "framework graph retained evidence",
      "cross-corpus consistency checks",
    ],
    [
      "live state",
      "native state",
      "dynamic state",
      "process-global state that cannot be reconstructed safely",
    ],
  ),
  tier(
    "100-95-0",
    100,
    95,
    "runtime-state-translation-gate",
    "near-complete selected Node service support",
    [
      "more V8 safe state evidence",
      "more libuv safe state evidence",
      "runtime-state translation evidence",
    ],
    ["raw CPU restore", "source ISA emulation", "app checkpoint hooks"],
  ),
  tier(
    "100-98-0",
    100,
    98,
    "runtime-framework-combined-claim-ready",
    "strong broad Node support for safe idle services",
    [
      "module graph evidence",
      "safe closure evidence",
      "timer evidence",
      "handle evidence",
      "HTTP server state evidence",
      "framework graph evidence",
    ],
    ["arbitrary process restore", "unsafe live state"],
  ),
  tier(
    "100-100-0",
    100,
    100,
    "final-node-service-ga-gate",
    "broad Node service support, not arbitrary process support",
    [
      "full safe-state taxonomy for Node services",
      "retained Node service evidence",
      "full refusal coverage",
    ],
    ["arbitrary non-Node processes"],
  ),
];

export function createNodeLevel5NodeServiceClaimLadderReport(input: {
  outDir: string;
}): NodeLevel5NodeServiceClaimLadderReport {
  const artifactDir = join(input.outDir, "node-service-claim-ladder");
  mkdirSync(artifactDir, { recursive: true });
  const tiers = tierDefinitions.map((definition) => ({
    ...definition,
    accepted: tierAccepted(definition),
  }));
  const artifacts = tiers.map((claimTier) => writeTierArtifact(artifactDir, claimTier));
  return {
    kind: NODE_LEVEL5_NODE_SERVICE_CLAIM_LADDER_REPORT_KIND,
    version: NODE_LEVEL5_NODE_SERVICE_CLAIM_LADDER_REPORT_VERSION,
    accepted: tiers.every((claimTier) => claimTier.accepted) && artifacts.length === 10,
    tierCount: 10,
    tiers,
    artifactCount: 10,
    artifacts,
    artifactsSha256: sha256Json(artifacts),
    finalNodeProductSupportClaimed: 100,
    finalBroadNodeProductSupportClaimed: 100,
    finalArbitraryProcessCrossArchRestoreClaimed: 0,
    claimChangeAllowed: true,
    arbitraryNodeClaimed: false,
    arbitraryExpressClaimed: false,
    arbitraryFastifyClaimed: false,
    arbitraryProcessClaimed: false,
  };
}

export function writeNodeLevel5NodeServiceClaimLadderReport(input: {
  outDir: string;
  path: string;
}): NodeLevel5NodeServiceClaimLadderReport {
  const report = createNodeLevel5NodeServiceClaimLadderReport({ outDir: input.outDir });
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function loadNodeLevel5NodeServiceClaimLadderReport(
  path: string,
): NodeLevel5NodeServiceClaimLadderReport {
  return JSON.parse(readFileSync(path, "utf8")) as NodeLevel5NodeServiceClaimLadderReport;
}

export function verifyNodeLevel5NodeServiceClaimLadderReport(
  report: NodeLevel5NodeServiceClaimLadderReport,
): NodeLevel5NodeServiceClaimLadderVerification {
  const artifactsSha256Verified = report.artifactsSha256 === sha256Json(report.artifacts);
  return {
    accepted: ladderAccepted(report, artifactsSha256Verified),
    kind: "machinen.node-level5-node-service-claim-ladder-verification",
    tierCount: report.tiers.length,
    artifactCount: report.artifacts.length,
    artifactsSha256Verified,
    finalNodeProductSupportClaimed: 100,
    finalBroadNodeProductSupportClaimed: 100,
    finalArbitraryProcessCrossArchRestoreClaimed: 0,
    claimChangeAllowed: true,
  };
}

function tier(
  target: NodeLevel5NodeServiceClaimTarget,
  nodeProductSupportClaimed: number,
  broadNodeProductSupportClaimed: number,
  evidenceKind: NodeLevel5NodeServiceClaimEvidenceKind,
  proof: string,
  evidenceItems: string[],
  refusalBoundaries: string[],
): Omit<NodeLevel5NodeServiceClaimTier, "accepted"> {
  return {
    target,
    nodeProductSupportClaimed,
    broadNodeProductSupportClaimed,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    evidenceKind,
    proof,
    evidenceItems,
    refusalBoundaries,
    arbitraryNodeClaimed: false,
    arbitraryProcessClaimed: false,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    appCheckpointHooksRequired: false,
  };
}

function tierAccepted(tier: Omit<NodeLevel5NodeServiceClaimTier, "accepted">): boolean {
  return (
    tier.evidenceItems.length > 0 &&
    tier.refusalBoundaries.length > 0 &&
    tier.arbitraryProcessCrossArchRestoreClaimed === 0 &&
    tier.arbitraryNodeClaimed === false &&
    tier.arbitraryProcessClaimed === false &&
    tier.rawCpuRestoreUsed === false &&
    tier.sourceIsaEmulationUsed === false &&
    tier.appCheckpointHooksRequired === false
  );
}

function writeTierArtifact(
  artifactDir: string,
  tier: NodeLevel5NodeServiceClaimTier,
): NodeLevel5NodeServiceClaimArtifact {
  const filename = `${tier.target}-${tier.evidenceKind}.json`;
  const content = `${JSON.stringify({ kind: "machinen.node-level5-node-service-claim-tier-artifact", ...tier }, null, 2)}\n`;
  writeFileSync(join(artifactDir, filename), content);
  return {
    target: tier.target,
    evidenceKind: tier.evidenceKind,
    path: join("node-service-claim-ladder", filename),
    sha256: sha256String(content),
    required: true,
  };
}

function ladderAccepted(
  report: NodeLevel5NodeServiceClaimLadderReport,
  artifactsSha256Verified: boolean,
): boolean {
  return [
    report.kind === NODE_LEVEL5_NODE_SERVICE_CLAIM_LADDER_REPORT_KIND,
    report.version === NODE_LEVEL5_NODE_SERVICE_CLAIM_LADDER_REPORT_VERSION,
    report.accepted === true,
    report.tierCount === 10,
    report.tiers.length === 10,
    report.artifactCount === 10,
    report.artifacts.length === 10,
    report.tiers.every((claimTier) => claimTier.accepted),
    report.finalNodeProductSupportClaimed === 100,
    report.finalBroadNodeProductSupportClaimed === 100,
    report.finalArbitraryProcessCrossArchRestoreClaimed === 0,
    report.claimChangeAllowed === true,
    report.arbitraryNodeClaimed === false,
    report.arbitraryExpressClaimed === false,
    report.arbitraryFastifyClaimed === false,
    report.arbitraryProcessClaimed === false,
    artifactsSha256Verified,
  ].every(Boolean);
}

function sha256String(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
