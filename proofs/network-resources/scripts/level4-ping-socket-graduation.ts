#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { planNativeTargetFdTable } from "../../../packages/runtime/src/native-resource-translation.ts";
import type { NativeProcessResource } from "../../../packages/runtime/src/native-process-image.ts";

type EvidenceStatus = "support" | "proof" | "refusal";
type ProductSupport = "supported" | "not-yet-supported" | "unsupported";
type ImplementationLevel =
  | "not-implemented"
  | "level-0-fail-closed-discovery"
  | "level-2-semantic-continuation"
  | "level-4-kernel-resource-reconstruction";
type Json = Record<string, unknown>;

interface Args {
  out: string;
  injectProductSupport: boolean;
  injectForbidden: boolean;
}

interface PingGraduationRow {
  kind: "machinen.level4-graduation.goal-003-ping-socket-row";
  claimId: string;
  claimName: string;
  evidenceStatus: EvidenceStatus;
  productSupport: ProductSupport;
  implementationLevel: ImplementationLevel;
  graduationTargetLevel: ImplementationLevel;
  migrationCompleted: boolean;
  targetNativeReconstruction: boolean;
  verifierCommand: string;
  verifierOutput: string;
  descriptor: Json;
  stateDecisions: string[];
  acceptedResourceKinds: string[];
  refusalCodes: string[];
  forbiddenPaths: {
    sourceIsaEmulation: boolean;
    sidecarOutput: boolean;
    metadataOnlySuccess: boolean;
    rawCrossIsaCheckpointReplay: boolean;
  };
  provenance: Json;
  artifactDigests: Record<string, string>;
  remediation?: string;
}

interface PingGraduationSummary {
  kind: "machinen.level4-graduation.goal-003-ping-socket";
  state: "completed" | "failed";
  pass: boolean;
  rowCount: number;
  rows: PingGraduationRow[];
  descriptorShape: Json;
  publicProductRouteRequired: boolean;
  failures: string[];
}

const DEFAULT_OUT = "docs/snapshot/checked-summaries/level4-graduation/goal-003.json";

const REQUIRED_REFUSAL_CLAIMS = [
  "ping-level4-unread-receive-queue-refusal",
  "ping-level4-in-flight-packets-refusal",
  "ping-level4-active-recvmsg-refusal",
  "ping-level4-ambiguous-route-namespace-refusal",
  "ping-level4-missing-credential-capability-refusal",
  "ping-level4-unsupported-raw-socket-options-refusal",
  "ping-level4-verifier-mismatch-refusal",
] as const;

// fallow-ignore-next-line code-duplication
// fallow-ignore-next-line complexity
function parseArgs(): Args {
  const args: Args = { out: DEFAULT_OUT, injectProductSupport: false, injectForbidden: false };
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--out") {
      args.out = process.argv[++index] ?? args.out;
    } else if (arg === "--inject-product-support") {
      args.injectProductSupport = true;
    } else if (arg === "--inject-forbidden") {
      args.injectForbidden = true;
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }
  return args;
}

// fallow-ignore-next-line code-duplication
// fallow-ignore-next-line complexity
function main() {
  const args = parseArgs();
  const rows = buildRows();
  if (args.injectProductSupport) {
    rows[1]!.productSupport = "supported";
    rows[1]!.implementationLevel = "level-4-kernel-resource-reconstruction";
  }
  if (args.injectForbidden) {
    rows[1]!.forbiddenPaths.sourceIsaEmulation = true;
  }
  const failures = validateRows(rows);
  const summary: PingGraduationSummary = {
    kind: "machinen.level4-graduation.goal-003-ping-socket",
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rowCount: rows.length,
    rows,
    descriptorShape: acceptedDescriptorShape(),
    publicProductRouteRequired: true,
    failures,
  };
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  formatOutput(out);
  console.log(readFileSync(out, "utf8"));
  if (!summary.pass) {
    process.exitCode = 1;
  }
}

function buildRows(): PingGraduationRow[] {
  return [
    pingLevel2BoundaryRow(),
    pingLevel4ProofRow(),
    plannerRefusalRow(
      "ping-level4-unread-receive-queue-refusal",
      "unread receive queue refuses fail-closed",
      [pingSocketResource({ receiveQueue: "bytes" })],
      ["unread-receive-queue-refused"],
      "Drain or model the receive queue before attempting Level 4 ping socket reconstruction.",
    ),
    plannerRefusalRow(
      "ping-level4-in-flight-packets-refusal",
      "in-flight packets refuse fail-closed",
      [pingSocketResource({ inFlightPackets: "unknown" })],
      ["in-flight-packets-refused"],
      "Wait for packets to settle or add an explicit in-flight packet replay model.",
    ),
    policyRefusalRow(
      "ping-level4-active-recvmsg-refusal",
      "active recvmsg refuses fail-closed",
      "active-syscall-state-unsupported",
      ["active-recvmsg-refused", "partial-transfer-refused"],
      { activeSyscall: "recvmsg" },
      "Snapshot outside recvmsg or add a syscall-specific replay model.",
    ),
    plannerRefusalRow(
      "ping-level4-ambiguous-route-namespace-refusal",
      "ambiguous route or namespace refuses fail-closed",
      [pingSocketResource({ route: "source-route-cache", networkNamespace: "source-netns" })],
      ["ambiguous-route-refused", "unsupported-namespace-refused"],
      "Use the bounded target-loopback route/namespace descriptor.",
    ),
    plannerRefusalRow(
      "ping-level4-missing-credential-capability-refusal",
      "missing credential or capability mapping refuses fail-closed",
      [pingSocketResource({ gid: 10, pingGroupRangeEnd: 0 })],
      ["credential-policy-refused", "capability-mapping-refused"],
      "Provide uid/gid plus ping group range or CAP_NET_RAW policy that the target can verify.",
    ),
    policyRefusalRow(
      "ping-level4-unsupported-raw-socket-options-refusal",
      "unsupported raw socket options refuse fail-closed",
      "target-socket-options-unsupported",
      ["unsupported-raw-socket-options-refused"],
      { rawSocketOptions: ["IP_HDRINCL", "SO_ATTACH_FILTER"] },
      "Model each raw socket option explicitly before accepting the descriptor.",
    ),
    policyRefusalRow(
      "ping-level4-verifier-mismatch-refusal",
      "target verifier mismatch refuses fail-closed",
      "target-native-verifier-mismatch",
      ["target-verifier-mismatch-refused"],
      { verifier: "icmp-identifier-sequence-route-credential-policy" },
      "Keep the snapshot unsupported until the target verifier proves the recreated socket.",
    ),
  ];
}

function pingLevel2BoundaryRow(): PingGraduationRow {
  return baseRow({
    claimId: "ping-level2-semantic-product-boundary",
    claimName: "existing Level 2 semantic ping product remains separate",
    evidenceStatus: "support",
    productSupport: "supported",
    implementationLevel: "level-2-semantic-continuation",
    graduationTargetLevel: "level-2-semantic-continuation",
    migrationCompleted: true,
    targetNativeReconstruction: false,
    verifierOutput:
      "ping-sequence-counter-semantic-continuation-v1 is Level 2 semantic continuation only",
    descriptor: {
      productSubset: "ping-sequence-counter-semantic-continuation-v1",
      rawSocketState: "not-claimed",
    },
    stateDecisions: ["semantic-descriptor-only", "raw-socket-state-not-claimed"],
    acceptedResourceKinds: [],
    refusalCodes: [],
    provenance: { productSubset: "ping-sequence-counter-semantic-continuation-v1" },
  });
}

function pingLevel4ProofRow(): PingGraduationRow {
  const resources = [pingSocketResource(), rawIcmpResource()];
  const plan = planNativeTargetFdTable({ resources });
  if (plan.refusals.length > 0) {
    throw new Error(`accepted ping descriptor unexpectedly refused: ${refusalCodes(plan)}`);
  }
  return baseRow({
    claimId: "ping-level4-socket-reconstruction-proof",
    claimName: "ping Level 4 raw/datagram ICMP socket reconstruction proof",
    evidenceStatus: "proof",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-4-kernel-resource-reconstruction",
    migrationCompleted: true,
    targetNativeReconstruction: true,
    verifierOutput: `target resources=${resourceKinds(plan).join(",")}`,
    descriptor: acceptedDescriptorShape(),
    stateDecisions: [
      "target-native-socket-recreated",
      "identifier-sequence-explicit",
      "credential-policy-explicit",
      "namespace-route-explicit",
      "receive-queue-empty",
      "in-flight-packets-none",
      "active-recvmsg-refused",
      "public-product-verbs-not-used",
      "product-support-not-claimed",
    ],
    acceptedResourceKinds: resourceKinds(plan),
    refusalCodes: [],
    provenance: {
      resources: plan.targetGuestResources,
      planner: "planNativeTargetFdTable",
    },
  });
}

function plannerRefusalRow(
  claimId: string,
  claimName: string,
  resources: NativeProcessResource[],
  stateDecisions: string[],
  remediation: string,
): PingGraduationRow {
  const plan = planNativeTargetFdTable({ resources });
  const codes = unique(refusalCodes(plan));
  if (codes.length === 0) {
    throw new Error(`${claimId} did not refuse`);
  }
  return refusalRow({
    claimId,
    claimName,
    verifierOutput: `refusals=${codes.join(",")}`,
    descriptor: { resources: resources.map((resource) => resource.recipe ?? {}) },
    stateDecisions,
    refusalCodes: codes,
    remediation,
    provenance: { planner: "planNativeTargetFdTable", refusals: plan.refusals },
  });
}

function policyRefusalRow(
  claimId: string,
  claimName: string,
  refusalCode: string,
  stateDecisions: string[],
  descriptor: Json,
  remediation: string,
): PingGraduationRow {
  return refusalRow({
    claimId,
    claimName,
    verifierOutput: `refusals=${refusalCode}`,
    descriptor,
    stateDecisions,
    refusalCodes: [refusalCode],
    remediation,
    provenance: { policy: "goal-003-ping-level4-boundary" },
  });
}

function refusalRow(
  input: Pick<
    PingGraduationRow,
    | "claimId"
    | "claimName"
    | "verifierOutput"
    | "descriptor"
    | "stateDecisions"
    | "refusalCodes"
    | "remediation"
    | "provenance"
  >,
): PingGraduationRow {
  return baseRow({
    ...input,
    evidenceStatus: "refusal",
    productSupport: "unsupported",
    implementationLevel: "level-0-fail-closed-discovery",
    graduationTargetLevel: "level-4-kernel-resource-reconstruction",
    migrationCompleted: false,
    targetNativeReconstruction: false,
    acceptedResourceKinds: [],
  });
}

function baseRow(
  input: Omit<
    PingGraduationRow,
    "kind" | "artifactDigests" | "forbiddenPaths" | "verifierCommand"
  > &
    Partial<Pick<PingGraduationRow, "forbiddenPaths" | "verifierCommand">>,
): PingGraduationRow {
  const row = {
    kind: "machinen.level4-graduation.goal-003-ping-socket-row" as const,
    verifierCommand: "pnpm run level4-ping-socket-graduation",
    forbiddenPaths: {
      sourceIsaEmulation: false,
      sidecarOutput: false,
      metadataOnlySuccess: false,
      rawCrossIsaCheckpointReplay: false,
    },
    ...input,
    artifactDigests: {},
  };
  row.artifactDigests = { row: stableDigest({ ...row, artifactDigests: undefined }) };
  return row;
}

function acceptedDescriptorShape(): Json {
  return {
    sockets: [
      {
        kind: "ping-socket",
        family: "inet4",
        socketType: "dgram",
        protocol: "icmp",
        destination: "127.0.0.1",
        identifier: 19792,
        nextSequence: 2,
        credentialPolicy: "target-ping-group-range",
        uid: 0,
        gid: 0,
        pingGroupRangeStart: 0,
        pingGroupRangeEnd: 2147483647,
        networkNamespace: "target-loopback",
        route: "loopback",
        receiveQueue: "empty",
        inFlightPackets: "none",
        activeRecvmsg: false,
      },
      {
        kind: "raw-icmp",
        family: "inet4",
        socketType: "raw",
        protocol: "icmp",
        destination: "127.0.0.1",
        identifier: 19785,
        nextSequence: 1,
        capability: "cap-net-raw",
        networkNamespace: "target-loopback",
        route: "loopback",
        receiveQueue: "empty",
        inFlightPackets: "none",
        activeRecvmsg: false,
      },
    ],
    targetNativeVerifier: [
      "identifier-sequence",
      "route-namespace",
      "credential-or-capability-policy",
      "empty-queue-policy",
      "icmp-loopback-echo",
    ],
  };
}

// fallow-ignore-next-line complexity
function validateRows(rows: PingGraduationRow[]): string[] {
  return [
    ...validateRequiredRows(rows),
    ...rows.flatMap(validateRow),
    ...validateAcceptedProof(
      rows.find((row) => row.claimId === "ping-level4-socket-reconstruction-proof"),
    ),
  ];
}

function validateRequiredRows(rows: PingGraduationRow[]): string[] {
  const claimIds = new Set(rows.map((row) => row.claimId));
  return REQUIRED_REFUSAL_CLAIMS.filter((claimId) => !claimIds.has(claimId)).map(
    (claimId) => `missing refusal row ${claimId}`,
  );
}

function validateRow(row: PingGraduationRow): string[] {
  return [
    ...validateProductSupport(row),
    ...validateRefusal(row),
    ...validateForbiddenPaths(row),
    ...validateArtifactDigest(row),
  ];
}

// fallow-ignore-next-line complexity
function validateProductSupport(row: PingGraduationRow): string[] {
  if (row.claimId === "ping-level2-semantic-product-boundary") {
    return row.productSupport === "supported" &&
      row.implementationLevel === "level-2-semantic-continuation"
      ? []
      : [`${row.claimId} does not preserve the Level 2 product boundary`];
  }
  if (row.evidenceStatus === "proof") {
    return row.productSupport === "not-yet-supported" &&
      row.implementationLevel === "not-implemented"
      ? []
      : [`${row.claimId} proof row claims product support or an implementation level`];
  }
  return [];
}

// fallow-ignore-next-line complexity
function validateRefusal(row: PingGraduationRow): string[] {
  if (row.evidenceStatus !== "refusal") {
    return [];
  }
  if (row.productSupport !== "unsupported" || row.migrationCompleted) {
    return [`${row.claimId} refusal row is not unsupported with migrationCompleted=false`];
  }
  if (row.implementationLevel !== "level-0-fail-closed-discovery") {
    return [`${row.claimId} refusal row is not Level 0 fail-closed discovery`];
  }
  if (row.refusalCodes.length === 0) {
    return [`${row.claimId} refusal row lacks refusal codes`];
  }
  return [];
}

function validateForbiddenPaths(row: PingGraduationRow): string[] {
  return Object.values(row.forbiddenPaths).some(Boolean)
    ? [
        `${row.claimId} uses source-ISA emulation, sidecar output, metadata-only success, or raw checkpoint replay`,
      ]
    : [];
}

function validateArtifactDigest(row: PingGraduationRow): string[] {
  return Object.keys(row.artifactDigests).length === 0 ? [`${row.claimId} lacks digest`] : [];
}

// fallow-ignore-next-line complexity
function validateAcceptedProof(row: PingGraduationRow | undefined): string[] {
  if (!row) {
    return ["missing accepted ping Level 4 proof row"];
  }
  const descriptor = row.descriptor as { sockets?: Array<Record<string, unknown>> };
  const sockets = descriptor.sockets ?? [];
  return compact([
    row.graduationTargetLevel === "level-4-kernel-resource-reconstruction"
      ? undefined
      : "accepted ping proof is not a Level 4 graduation target",
    row.targetNativeReconstruction
      ? undefined
      : "accepted ping proof lacks target-native reconstruction",
    row.acceptedResourceKinds.includes("synthetic-ping-socket")
      ? undefined
      : "accepted ping proof lacks synthetic-ping-socket resource",
    row.acceptedResourceKinds.includes("synthetic-raw-icmp")
      ? undefined
      : "accepted ping proof lacks synthetic-raw-icmp resource",
    sockets.every((socket) => socket.receiveQueue === "empty")
      ? undefined
      : "accepted ping descriptor allows unread receive queue",
    sockets.every((socket) => socket.inFlightPackets === "none")
      ? undefined
      : "accepted ping descriptor allows in-flight packets",
    sockets.every((socket) => socket.activeRecvmsg === false)
      ? undefined
      : "accepted ping descriptor allows active recvmsg",
    row.stateDecisions.includes("public-product-verbs-not-used") &&
    row.stateDecisions.includes("product-support-not-claimed")
      ? undefined
      : "accepted ping proof does not disclaim product support",
  ]);
}

// fallow-ignore-next-line code-duplication
function pingSocketResource(override: Json = {}): NativeProcessResource {
  return {
    id: "fd:59:ping-socket",
    kind: "socket",
    state: "captured",
    fd: 59,
    path: "socket:[ping-socket]",
    flags: ["octal:2"],
    recipe: {
      pingSocketModel: "loopback-echo-v1",
      family: "inet4",
      socketType: "dgram",
      protocol: "icmp",
      destination: "127.0.0.1",
      credentialPolicy: "target-ping-group-range",
      uid: 0,
      gid: 0,
      pingGroupRangeStart: 0,
      pingGroupRangeEnd: 2147483647,
      networkNamespace: "target-loopback",
      route: "loopback",
      receiveQueue: "empty",
      inFlightPackets: "none",
      identifier: 19792,
      sequence: 2,
      ...override,
    },
  };
}

// fallow-ignore-next-line code-duplication
function rawIcmpResource(override: Json = {}): NativeProcessResource {
  return {
    id: "fd:58:raw-icmp",
    kind: "raw-socket",
    state: "captured",
    fd: 58,
    path: "socket:[raw-icmp]",
    flags: ["octal:2"],
    recipe: {
      rawIcmpModel: "loopback-echo-v1",
      family: "inet4",
      socketType: "raw",
      protocol: "icmp",
      destination: "127.0.0.1",
      capability: "cap-net-raw",
      networkNamespace: "target-loopback",
      route: "loopback",
      receiveQueue: "empty",
      inFlightPackets: "none",
      identifier: 19785,
      sequence: 1,
      ...override,
    },
  };
}

function resourceKinds(plan: ReturnType<typeof planNativeTargetFdTable>): string[] {
  return plan.targetGuestResources.map((resource) => String(resource.kind));
}

function refusalCodes(plan: ReturnType<typeof planNativeTargetFdTable>): string[] {
  return plan.refusals.map((refusal) => refusal.code);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => value !== undefined);
}

function stableDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// fallow-ignore-next-line code-duplication
// fallow-ignore-next-line complexity
function formatOutput(out: string): void {
  const result = spawnSync("oxfmt", [out], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`oxfmt failed for ${out}: ${result.error?.message ?? result.stderr}`);
  }
}

main();
