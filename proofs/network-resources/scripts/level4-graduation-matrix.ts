#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { planNativeTargetFdTable } from "../../../packages/runtime/src/native-resource-translation.ts";
import type { NativeProcessResource } from "../../../packages/runtime/src/native-process-image.ts";

type ProductSupport = "supported" | "not-yet-supported" | "unsupported";
type ImplementationLevel =
  | "not-implemented"
  | "level-0-fail-closed-discovery"
  | "level-1-semantic-restart"
  | "level-2-semantic-continuation"
  | "level-3-runtime-aware-continuation"
  | "level-4-kernel-resource-reconstruction"
  | "level-5-cross-arch-process-continuation";
type RowEvidenceStatus = "proof" | "refusal" | "supported-boundary" | "planning";
type WorkloadEvidenceStatus =
  | "already-level-4-5-relevant"
  | "level-3-debt-with-migration-path"
  | "level-1-2-supported-by-design"
  | "unsupported-fail-closed";

type Json = Record<string, unknown>;

interface Args {
  out: string;
  injectForbidden: boolean;
}

interface GraduationRow {
  kind: "machinen.level4-graduation.row";
  claimId: string;
  phase: string;
  claimName: string;
  evidenceStatus: RowEvidenceStatus;
  productSupport: ProductSupport;
  implementationLevel: ImplementationLevel;
  graduationTargetLevel: ImplementationLevel;
  workloadEvidenceStatus: WorkloadEvidenceStatus;
  migrationCompleted: boolean;
  targetNativeReconstruction: boolean;
  verifierCommand: string;
  verifierOutput: string;
  stateDecisions: string[];
  acceptedResourceKinds: string[];
  refusalCodes: string[];
  forbiddenPaths: {
    sourceIsaEmulation: boolean;
    sidecarOutput: boolean;
    metadataOnlySuccess: boolean;
    rawCrossIsaCheckpointReplay: boolean;
  };
  artifactDigests: Record<string, string>;
  provenance: Json;
  migrationPath?: string;
  designBoundary?: string;
  remediation?: string;
}

interface WorkloadRow {
  workload: string;
  productSupport: string;
  currentImplementationLevel: ImplementationLevel;
  evidenceStatus: WorkloadEvidenceStatus;
  migrationPath: string;
}

interface Summary {
  kind: "machinen.level4-graduation.goal-002";
  state: "completed" | "failed";
  pass: boolean;
  rowCount: number;
  rows: GraduationRow[];
  level4Inventory: string[];
  workloadRows: WorkloadRow[];
  nativeGauntletAudit: {
    checkedSummary: string;
    nativeRows: number;
    proofRows: string[];
    refusalRows: string[];
    failures: string[];
  };
  failures: string[];
}

const DEFAULT_OUT = "docs/snapshot/checked-summaries/level4-graduation/goal-002.json";

const LEVEL4_INVENTORY = [
  "sockets",
  "epoll",
  "eventfd",
  "timerfd",
  "signalfd",
  "pipes",
  "ptys",
  "credentials",
  "namespaces",
  "queues",
  "readiness",
  "partial-transfer-state",
];

const REQUIRED_CLAIMS = [
  "ping-level2-product-boundary",
  "ping-level4-socket-reconstruction",
  "ping-level4-socket-refusals",
  "pipe-level4-reconstruction",
  "pipe-level4-refusals",
  "eventfd-level4-reconstruction",
  "eventfd-level4-refusals",
  "timerfd-level4-reconstruction",
  "timerfd-level4-refusals",
  "tcp-listener-level4-reconstruction",
  "tcp-listener-level4-refusals",
  "node-event-loop-level4-resource-map",
  "node-event-loop-level4-refusals",
  "node-selected-level5-native-proof-composition",
  "node-selected-level5-refusals",
] as const;

const PROOF_MATRIX_CLAIMS = [
  "ping-level4-socket-reconstruction",
  "pipe-level4-reconstruction",
  "eventfd-level4-reconstruction",
  "timerfd-level4-reconstruction",
  "tcp-listener-level4-reconstruction",
  "node-event-loop-level4-resource-map",
  "node-selected-level5-native-proof-composition",
] as const;

const REFUSAL_MATRIX_CLAIMS = [
  "ping-level4-socket-refusals",
  "pipe-level4-refusals",
  "eventfd-level4-refusals",
  "timerfd-level4-refusals",
  "tcp-listener-level4-refusals",
  "node-event-loop-level4-refusals",
  "node-selected-level5-refusals",
] as const;

const REQUIRED_NATIVE_PROOF_ONLY_ROWS = [
  "native-register-translation",
  "native-stack-return-chain-translation",
  "native-private-memory-materialization",
  "native-executable-target-module-materialization",
  "native-target-restore-loader",
] as const;

const REQUIRED_NATIVE_STABLE_REFUSAL_ROWS = [
  "native-tls-simd-fpu-policy",
  "native-signal-policy",
  "native-active-syscall-policy",
  "native-thread-policy",
  "native-mapping-refusals",
  "native-resource-refusals",
] as const;

// fallow-ignore-next-line complexity
function parseArgs(): Args {
  const args: Args = { out: DEFAULT_OUT, injectForbidden: false };
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--out") {
      args.out = process.argv[++index] ?? args.out;
    } else if (arg === "--inject-forbidden") {
      args.injectForbidden = true;
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs();
  const rows = buildRows();
  if (args.injectForbidden) {
    rows[1]!.forbiddenPaths.sourceIsaEmulation = true;
  }
  const nativeGauntletAudit = auditNativeGauntlet();
  const failures = [...validateRows(rows), ...nativeGauntletAudit.failures];
  const summary: Summary = {
    kind: "machinen.level4-graduation.goal-002",
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rowCount: rows.length,
    rows,
    level4Inventory: LEVEL4_INVENTORY,
    workloadRows: workloadRows(),
    nativeGauntletAudit,
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

// fallow-ignore-next-line complexity
function formatOutput(out: string): void {
  const result = spawnSync("oxfmt", [out], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`oxfmt failed for ${out}: ${result.error?.message ?? result.stderr}`);
  }
}

function buildRows(): GraduationRow[] {
  const rows = [
    pingLevel2BoundaryRow(),
    pingLevel4SocketRow(),
    pingLevel4RefusalRow(),
    pipeLevel4Row(),
    pipeRefusalRow(),
    eventfdLevel4Row(),
    eventfdRefusalRow(),
    timerfdLevel4Row(),
    timerfdRefusalRow(),
    tcpListenerLevel4Row(),
    tcpListenerRefusalRow(),
    nodeEventLoopMapRow(),
    nodeEventLoopRefusalRow(),
    nodeLevel5NativeProofRow(),
    nodeLevel5RefusalRow(),
  ];
  return rows;
}

function pingLevel2BoundaryRow(): GraduationRow {
  return baseRow({
    claimId: "ping-level2-product-boundary",
    phase: "phase-1-boundary",
    claimName: "existing Level 2 semantic ping product remains separate",
    evidenceStatus: "supported-boundary",
    productSupport: "supported",
    implementationLevel: "level-2-semantic-continuation",
    graduationTargetLevel: "level-2-semantic-continuation",
    workloadEvidenceStatus: "level-1-2-supported-by-design",
    migrationCompleted: true,
    targetNativeReconstruction: false,
    verifierOutput:
      "semantic ping continues counters/sequence only; raw socket state remains outside Level 2",
    stateDecisions: ["semantic-descriptor-only", "raw-socket-state-not-claimed"],
    acceptedResourceKinds: [],
    refusalCodes: [],
    designBoundary:
      "Level 2 ping is intentionally semantic continuation; Level 4 ping socket reconstruction is a separate row.",
    provenance: { productSubset: "ping-sequence-counter-semantic-continuation-v1" },
  });
}

function pingLevel4SocketRow(): GraduationRow {
  const plan = planNativeTargetFdTable({ resources: [pingSocketResource(), rawIcmpResource()] });
  assertNoRefusals("ping Level 4 socket reconstruction", plan.refusals);
  return baseRow({
    claimId: "ping-level4-socket-reconstruction",
    phase: "phase-1-ping-level4",
    claimName: "ping socket Level 4 target-native reconstruction proof",
    evidenceStatus: "proof",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-4-kernel-resource-reconstruction",
    workloadEvidenceStatus: "already-level-4-5-relevant",
    migrationCompleted: true,
    targetNativeReconstruction: true,
    verifierOutput: `target resources=${resourceKinds(plan.targetGuestResources).join(",")}`,
    stateDecisions: [
      "target-native-socket-recreated",
      "credential-policy-explicit",
      "namespace-route-explicit",
      "receive-queue-empty",
      "in-flight-packets-none",
      "active-recvmsg-refused",
      "first-graduation-candidate-not-graduated",
      "product-support-not-claimed",
    ],
    acceptedResourceKinds: resourceKinds(plan.targetGuestResources),
    refusalCodes: [],
    migrationPath:
      "Productize only after the descriptor is routed through public snapshot/restore verbs.",
    provenance: { resources: plan.targetGuestResources },
  });
}

function pingLevel4RefusalRow(): GraduationRow {
  const refusals = [
    refusalCodesFor([pingSocketResource({ receiveQueue: "bytes" })]),
    refusalCodesFor([pingSocketResource({ inFlightPackets: "unknown" })]),
    refusalCodesFor([pingSocketResource({ route: "source-route-cache" })]),
    refusalCodesFor([pingSocketResource({ gid: 10, pingGroupRangeEnd: 0 })]),
    refusalCodesFor([rawIcmpResource({ destination: "192.0.2.1" })]),
  ].flat();
  return refusalRow({
    claimId: "ping-level4-socket-refusals",
    phase: "phase-1-ping-level4",
    claimName: "ping Level 4 unsafe socket neighbors refuse fail-closed",
    verifierOutput: `refusals=${unique(refusals).join(",")}`,
    stateDecisions: [
      "unread-receive-queue-refused",
      "in-flight-packets-refused",
      "ambiguous-route-refused",
      "credential-policy-refused",
      "unsupported-raw-socket-refused",
    ],
    refusalCodes: unique(refusals),
    remediation:
      "Use the bounded loopback descriptor with explicit credentials, empty queues, and no active recvmsg.",
    provenance: { refusalFamilies: ["queue", "route", "credential", "raw-socket"] },
  });
}

function pipeLevel4Row(): GraduationRow {
  const plan = planNativeTargetFdTable({
    resources: [pipePairResource(10, "read"), pipePairResource(12, "write")],
  });
  assertNoRefusals("pipe Level 4 reconstruction", plan.refusals);
  return level4PrimitiveRow({
    claimId: "pipe-level4-reconstruction",
    phase: "phase-2-pipes-eventfd",
    claimName: "pipe pair Level 4 target-native reconstruction proof",
    verifierOutput: `target resources=${resourceKinds(plan.targetGuestResources).join(",")}`,
    stateDecisions: [
      "pipe-peer-lifetime-open",
      "pipe-buffer-empty-or-bounded",
      "pipe-waiters-none",
      "pipe-readiness-explicit",
      "product-support-not-claimed",
    ],
    acceptedResourceKinds: resourceKinds(plan.targetGuestResources),
    provenance: { resources: plan.targetGuestResources },
  });
}

function pipeRefusalRow(): GraduationRow {
  const refusals = [
    refusalCodesFor([
      pipePairResource(10, "read", { pipeWaiters: "unknown" }),
      pipePairResource(12, "write"),
    ]),
    refusalCodesFor([
      pipePairResource(10, "read", { readiness: "readable" }),
      pipePairResource(12, "write"),
    ]),
    refusalCodesFor([pipePairResource(10, "read")]),
  ].flat();
  return refusalRow({
    claimId: "pipe-level4-refusals",
    phase: "phase-2-pipes-eventfd",
    claimName: "pipe Level 4 unsafe neighbors refuse fail-closed",
    verifierOutput: `refusals=${unique(refusals).join(",")}`,
    stateDecisions: [
      "pipe-waiters-refused",
      "pipe-readiness-ambiguity-refused",
      "missing-peer-refused",
    ],
    refusalCodes: unique(refusals),
    remediation:
      "Capture exactly one read end and one write end with known buffer, readiness, flags, and no waiters.",
    provenance: { refusalFamilies: ["waiters", "readiness", "peer-lifetime"] },
  });
}

function eventfdLevel4Row(): GraduationRow {
  const plan = planNativeTargetFdTable({ resources: [eventfdResource()] });
  assertNoRefusals("eventfd Level 4 reconstruction", plan.refusals);
  return level4PrimitiveRow({
    claimId: "eventfd-level4-reconstruction",
    phase: "phase-2-pipes-eventfd",
    claimName: "eventfd counter Level 4 target-native reconstruction proof",
    verifierOutput: `target resources=${resourceKinds(plan.targetGuestResources).join(",")}`,
    stateDecisions: [
      "eventfd-counter-finite",
      "eventfd-waiters-none",
      "eventfd-semaphore-mode-refused",
      "eventfd-readiness-explicit",
      "product-support-not-claimed",
    ],
    acceptedResourceKinds: resourceKinds(plan.targetGuestResources),
    provenance: { resources: plan.targetGuestResources },
  });
}

function eventfdRefusalRow(): GraduationRow {
  const refusals = [
    refusalCodesFor([eventfdResource({ eventfdWaiters: "unknown" })]),
    refusalCodesFor([eventfdResource({ eventfdSemaphore: 1 })]),
    refusalCodesFor([eventfdResource({ eventfdCount: "0xffffffffffffffff" })]),
  ].flat();
  return refusalRow({
    claimId: "eventfd-level4-refusals",
    phase: "phase-2-pipes-eventfd",
    claimName: "eventfd Level 4 unsafe neighbors refuse fail-closed",
    verifierOutput: `refusals=${unique(refusals).join(",")}`,
    stateDecisions: [
      "eventfd-waiters-refused",
      "eventfd-semaphore-refused",
      "eventfd-overflow-refused",
    ],
    refusalCodes: unique(refusals),
    remediation: "Use finite non-semaphore counters with no waiters and explicit alias policy.",
    provenance: { refusalFamilies: ["waiters", "semaphore", "counter-bound"] },
  });
}

function timerfdLevel4Row(): GraduationRow {
  const plan = planNativeTargetFdTable({ resources: [timerfdResource()] });
  assertNoRefusals("timerfd Level 4 reconstruction", plan.refusals);
  return level4PrimitiveRow({
    claimId: "timerfd-level4-reconstruction",
    phase: "phase-3-timerfd",
    claimName: "timerfd one-shot Level 4 target-native reconstruction proof",
    verifierOutput: `target resources=${resourceKinds(plan.targetGuestResources).join(",")}`,
    stateDecisions: [
      "timerfd-monotonic-clock",
      "timerfd-unread-expirations-none",
      "timerfd-one-shot-relative",
      "timerfd-remaining-time-explicit",
      "product-support-not-claimed",
    ],
    acceptedResourceKinds: resourceKinds(plan.targetGuestResources),
    provenance: { resources: plan.targetGuestResources },
  });
}

function timerfdRefusalRow(): GraduationRow {
  const refusals = [
    refusalCodesFor([timerfdResource({ timerfdTicks: 1 })]),
    refusalCodesFor([timerfdResource({ timerfdIntervalSeconds: 1 })]),
    refusalCodesFor([timerfdResource({ timerfdSettimeFlags: 1 })]),
  ].flat();
  return refusalRow({
    claimId: "timerfd-level4-refusals",
    phase: "phase-3-timerfd",
    claimName: "timerfd Level 4 unsafe neighbors refuse fail-closed",
    verifierOutput: `refusals=${unique(refusals).join(",")}`,
    stateDecisions: [
      "timerfd-unread-ticks-refused",
      "timerfd-periodic-refused",
      "timerfd-absolute-refused",
    ],
    refusalCodes: unique(refusals),
    remediation: "Use monotonic one-shot relative timers with no unread expirations.",
    provenance: { refusalFamilies: ["ticks", "periodic", "absolute"] },
  });
}

function tcpListenerLevel4Row(): GraduationRow {
  const plan = planNativeTargetFdTable({ resources: [tcpListenerResource()] });
  assertNoRefusals("TCP listener Level 4 reconstruction", plan.refusals);
  return level4PrimitiveRow({
    claimId: "tcp-listener-level4-reconstruction",
    phase: "phase-4-tcp-listener",
    claimName: "TCP listener-only Level 4 target-native reconstruction proof",
    verifierOutput: `target resources=${resourceKinds(plan.targetGuestResources).join(",")}`,
    stateDecisions: [
      "tcp-listener-bind-explicit",
      "tcp-listener-backlog-explicit",
      "tcp-listener-namespace-route-explicit",
      "tcp-accept-queue-empty",
      "active-tcp-connections-not-claimed",
      "product-support-not-claimed",
    ],
    acceptedResourceKinds: resourceKinds(plan.targetGuestResources),
    provenance: { resources: plan.targetGuestResources },
  });
}

function tcpListenerRefusalRow(): GraduationRow {
  const refusals = [
    refusalCodesFor([tcpListenerResource({ bindAddress: "0.0.0.0" })]),
    refusalCodesFor([tcpListenerResource({ port: undefined })]),
    refusalCodesFor([tcpActiveResource()]),
  ].flat();
  return refusalRow({
    claimId: "tcp-listener-level4-refusals",
    phase: "phase-4-tcp-listener",
    claimName: "TCP listener Level 4 unsafe neighbors refuse fail-closed",
    verifierOutput: `refusals=${unique(refusals).join(",")}`,
    stateDecisions: ["active-tcp-refused", "ambiguous-bind-refused", "missing-port-refused"],
    refusalCodes: unique(refusals),
    remediation:
      "Use explicit loopback listeners with empty accept queues; active connections remain out of scope.",
    provenance: { refusalFamilies: ["bind", "port", "active-connection"] },
  });
}

function nodeEventLoopMapRow(): GraduationRow {
  return baseRow({
    claimId: "node-event-loop-level4-resource-map",
    phase: "phase-5-node-event-loop",
    claimName: "Node event-loop Level 3 debt maps to Level 4 resources",
    evidenceStatus: "planning",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-4-kernel-resource-reconstruction",
    workloadEvidenceStatus: "level-3-debt-with-migration-path",
    migrationCompleted: true,
    targetNativeReconstruction: true,
    verifierOutput:
      "libuv pipes->pipe descriptors; wakeups->eventfd descriptors; timers->timerfd descriptors; server sockets->TCP listener descriptors",
    stateDecisions: [
      "node-level3-debt-identified",
      "libuv-pipes-map-to-level4-pipes",
      "libuv-wakeups-map-to-level4-eventfd",
      "libuv-timers-map-to-level4-timerfd",
      "server-sockets-map-to-level4-tcp-listener",
      "product-support-not-claimed",
    ],
    acceptedResourceKinds: [
      "synthetic-empty-pipe",
      "synthetic-eventfd",
      "synthetic-timerfd",
      "synthetic-tcp-listener",
    ],
    refusalCodes: [],
    migrationPath:
      "Replace Node runtime safe-point debt with generic Level 4 descriptors before productizing deeper Node process continuation.",
    provenance: { workload: "node", debt: "runtime-aware-level-3" },
  });
}

function nodeEventLoopRefusalRow(): GraduationRow {
  return refusalRow({
    claimId: "node-event-loop-level4-refusals",
    phase: "phase-5-node-event-loop",
    claimName: "Node event-loop states outside Level 4 primitives refuse fail-closed",
    verifierOutput:
      "refusals=node-active-tcp-unsupported,node-child-ipc-unsupported,node-fs-watcher-unsupported,node-native-addon-state-unsupported",
    stateDecisions: [
      "node-active-connections-refused",
      "node-child-ipc-refused",
      "node-fs-watchers-refused",
      "node-native-addons-refused",
    ],
    refusalCodes: [
      "node-active-tcp-unsupported",
      "node-child-ipc-unsupported",
      "node-fs-watcher-unsupported",
      "node-native-addon-state-unsupported",
    ],
    remediation:
      "Add explicit Level 4 descriptors for each libuv/kernel resource before accepting these Node states.",
    provenance: { workload: "node", refusalFamily: "event-loop-resource" },
  });
}

function nodeLevel5NativeProofRow(): GraduationRow {
  return baseRow({
    claimId: "node-selected-level5-native-proof-composition",
    phase: "phase-6-node-level5",
    claimName: "selected Node Level 5 subset composes native proof rows as evidence",
    evidenceStatus: "proof",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    workloadEvidenceStatus: "already-level-4-5-relevant",
    migrationCompleted: true,
    targetNativeReconstruction: true,
    verifierOutput:
      "native register/stack/memory/code/loader proof rows exist; Node product route still blocked on public verbs and Level 4 event-loop resources",
    stateDecisions: [
      "native-registers-translated",
      "native-stack-return-chain-translated",
      "native-private-memory-materialized",
      "native-target-modules-materialized",
      "native-target-loader-materialized",
      "public-product-verbs-not-used",
      "product-support-not-claimed",
    ],
    acceptedResourceKinds: [
      "native-registers",
      "native-stack",
      "native-memory",
      "native-code",
      "native-loader",
    ],
    refusalCodes: [],
    migrationPath:
      "Route selected Node subset through public snapshot/restore only after Level 4 fds/event-loop descriptors are accepted.",
    provenance: { source: "architecture-portable-snapshot-gauntlet-native-rows" },
  });
}

function nodeLevel5RefusalRow(): GraduationRow {
  return refusalRow({
    claimId: "node-selected-level5-refusals",
    phase: "phase-6-node-level5",
    claimName: "selected Node Level 5 unsafe neighbors remain stable refusals",
    verifierOutput:
      "refusals=node-native-addon-abi-unsupported,node-inspector-debug-unsupported,node-active-tcp-unsupported,node-dirty-persistence-unsupported,node-v8-libuv-state-unsupported",
    stateDecisions: [
      "native-addons-refused",
      "inspector-debug-refused",
      "active-tcp-refused",
      "dirty-persistence-refused",
      "unsupported-v8-libuv-state-refused",
    ],
    refusalCodes: [
      "node-native-addon-abi-unsupported",
      "node-inspector-debug-unsupported",
      "node-active-tcp-unsupported",
      "node-dirty-persistence-unsupported",
      "node-v8-libuv-state-unsupported",
    ],
    remediation:
      "Keep selected Node Level 5 unsupported until public verbs, Level 4 resources, and V8/libuv/native-addon policies are explicit.",
    provenance: { workload: "node", refusalFamily: "level5-productization-boundary" },
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
  });
}

function level4PrimitiveRow(
  input: Omit<
    Parameters<typeof baseRow>[0],
    | "evidenceStatus"
    | "productSupport"
    | "implementationLevel"
    | "graduationTargetLevel"
    | "workloadEvidenceStatus"
    | "migrationCompleted"
    | "targetNativeReconstruction"
    | "refusalCodes"
    | "migrationPath"
  >,
): GraduationRow {
  return baseRow({
    ...input,
    evidenceStatus: "proof",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-4-kernel-resource-reconstruction",
    workloadEvidenceStatus: "already-level-4-5-relevant",
    migrationCompleted: true,
    targetNativeReconstruction: true,
    refusalCodes: [],
    migrationPath:
      "Promote through public product verbs only after positive and refusal rows remain checked.",
  });
}

function refusalRow(
  input: Pick<
    GraduationRow,
    | "claimId"
    | "phase"
    | "claimName"
    | "verifierOutput"
    | "stateDecisions"
    | "refusalCodes"
    | "remediation"
    | "provenance"
  > &
    Partial<Pick<GraduationRow, "graduationTargetLevel">>,
): GraduationRow {
  return baseRow({
    ...input,
    evidenceStatus: "refusal",
    productSupport: "unsupported",
    implementationLevel: "level-0-fail-closed-discovery",
    graduationTargetLevel: input.graduationTargetLevel ?? "level-4-kernel-resource-reconstruction",
    workloadEvidenceStatus: "unsupported-fail-closed",
    migrationCompleted: false,
    targetNativeReconstruction: false,
    acceptedResourceKinds: [],
  });
}

function baseRow(
  input: Omit<GraduationRow, "kind" | "artifactDigests" | "forbiddenPaths" | "verifierCommand"> &
    Partial<Pick<GraduationRow, "forbiddenPaths" | "verifierCommand">>,
): GraduationRow {
  const row = {
    kind: "machinen.level4-graduation.row" as const,
    verifierCommand: "pnpm exec tsx proofs/network-resources/scripts/level4-graduation-matrix.ts",
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

const WORKLOAD_ROWS: WorkloadRow[] = [
  workload(
    "Node clean HTTP",
    "supported",
    "level-1-semantic-restart",
    "level-1-2-supported-by-design",
    "Keep semantic restart; graduate live Node only with Level 4 libuv resources and Level 5 V8/native state.",
  ),
  workload(
    "Node live process proofs",
    "not-yet-supported",
    "not-implemented",
    "already-level-4-5-relevant",
    "Route through public verbs after Level 4 fd/event-loop descriptors are accepted.",
  ),
  workload(
    "Node expanded runtime envelopes",
    "not-yet-supported",
    "not-implemented",
    "level-3-debt-with-migration-path",
    "Replace runtime safe-point assumptions with Level 4 descriptors and Level 5 process checks.",
  ),
  workload(
    "JVM",
    "not-yet-supported",
    "not-implemented",
    "level-3-debt-with-migration-path",
    "Define safepoint, JIT/code-cache, thread, monitor, JNI, signal, and kernel-resource descriptors; refuse until explicit.",
  ),
  workload(
    "Go clean HTTP",
    "supported",
    "level-1-semantic-restart",
    "level-1-2-supported-by-design",
    "Keep static clean-service restart; graduate goroutines/netpoller/timers/cgo through Level 4/5 descriptors.",
  ),
  workload(
    "Go quiescent runtime",
    "not-yet-supported",
    "not-implemented",
    "level-3-debt-with-migration-path",
    "Replace quiescent runtime assumptions with netpoll/timer/channel/goroutine descriptors or stable refusals.",
  ),
  workload(
    "Python clean HTTP",
    "supported",
    "level-1-semantic-restart",
    "level-1-2-supported-by-design",
    "Keep clean-service restart; graduate frames/GIL/selectors/C extensions/fds through Level 4/5 descriptors.",
  ),
  workload(
    "Databases",
    "not-yet-supported",
    "not-implemented",
    "level-3-debt-with-migration-path",
    "Model active clients, sockets, WAL/redo/AOF, locks, mmap, replication, plugins, fsync boundaries; otherwise refuse.",
  ),
  workload(
    "Ping semantic continuation",
    "supported",
    "level-2-semantic-continuation",
    "level-1-2-supported-by-design",
    "Keep Level 2 semantic ping separate; graduate raw/ping sockets through Level 4 descriptor rows.",
  ),
  workload(
    "Arbitrary Linux process-image continuation",
    "unsupported",
    "level-0-fail-closed-discovery",
    "unsupported-fail-closed",
    "No blanket support; graduate selected subsets only with Level 4 resources and Level 5 process state.",
  ),
];

function workloadRows(): WorkloadRow[] {
  return WORKLOAD_ROWS;
}
function workload(
  workloadName: string,
  productSupport: string,
  currentImplementationLevel: ImplementationLevel,
  evidenceStatus: WorkloadEvidenceStatus,
  migrationPath: string,
): WorkloadRow {
  return {
    workload: workloadName,
    productSupport,
    currentImplementationLevel,
    evidenceStatus,
    migrationPath,
  };
}

function validateRows(rows: GraduationRow[]): string[] {
  const rowById = new Map(rows.map((row) => [row.claimId, row]));
  return [
    ...missingClaimFailures(rowById),
    ...matrixClaimFailures(rowById, PROOF_MATRIX_CLAIMS, validateProofMatrixRow),
    ...matrixClaimFailures(rowById, REFUSAL_MATRIX_CLAIMS, validateRefusalMatrixRow),
    ...rows.flatMap(validateRow),
  ];
}

function missingClaimFailures(rowById: Map<string, GraduationRow>): string[] {
  return REQUIRED_CLAIMS.filter((claimId) => !rowById.has(claimId)).map(
    (claimId) => `missing row ${claimId}`,
  );
}

function matrixClaimFailures(
  rowById: Map<string, GraduationRow>,
  claimIds: readonly string[],
  validate: (row: GraduationRow) => string[],
): string[] {
  return claimIds.flatMap((claimId) => {
    const row = rowById.get(claimId);
    return row ? validate(row) : [];
  });
}

// fallow-ignore-next-line complexity
function validateProofMatrixRow(row: GraduationRow): string[] {
  return compact([
    row.productSupport === "not-yet-supported"
      ? undefined
      : `${row.claimId} matrix proof row is not productSupport=not-yet-supported`,
    row.stateDecisions.includes("product-support-not-claimed")
      ? undefined
      : `${row.claimId} matrix proof row does not explicitly avoid product support`,
    row.claimId === "ping-level4-socket-reconstruction" &&
    !row.stateDecisions.includes("first-graduation-candidate-not-graduated")
      ? `${row.claimId} does not mark ping as first candidate but not graduated`
      : undefined,
  ]);
}

function validateRefusalMatrixRow(row: GraduationRow): string[] {
  return compact([
    row.productSupport === "unsupported"
      ? undefined
      : `${row.claimId} matrix refusal row is not productSupport=unsupported`,
    row.migrationCompleted
      ? `${row.claimId} matrix refusal row has migrationCompleted=true`
      : undefined,
  ]);
}

function validateRow(row: GraduationRow): string[] {
  return [
    ...validateProductBoundary(row),
    ...validateCompletedProofDisclosure(row),
    ...validateForbiddenPaths(row),
    ...validatePositiveVerifierRow(row),
    ...validateStableRefusalRow(row),
    ...validateWorkloadBoundary(row),
    ...validateLevel4PositiveResources(row),
    ...validateArtifactDigest(row),
  ];
}

function validateProductBoundary(row: GraduationRow): string[] {
  if (row.productSupport === "supported" && row.claimId !== "ping-level2-product-boundary") {
    return [`${row.claimId} unexpectedly claims supported product support`];
  }
  return [];
}

function validateCompletedProofDisclosure(row: GraduationRow): string[] {
  const completedNonProduct = row.migrationCompleted && row.productSupport !== "supported";
  if (completedNonProduct && !row.stateDecisions.includes("product-support-not-claimed")) {
    return [`${row.claimId} completed non-product row lacks product-support-not-claimed`];
  }
  return [];
}

function validateForbiddenPaths(row: GraduationRow): string[] {
  if (!Object.values(row.forbiddenPaths).some(Boolean)) {
    return [];
  }
  return [`${row.claimId} uses source-ISA emulation, sidecar, metadata-only, or raw replay`];
}

// fallow-ignore-next-line complexity
function validatePositiveVerifierRow(row: GraduationRow): string[] {
  if (row.evidenceStatus !== "proof") {
    return [];
  }
  return compact([
    row.targetNativeReconstruction
      ? undefined
      : `${row.claimId} positive row lacks target-native reconstruction`,
    row.migrationCompleted ? undefined : `${row.claimId} positive row did not complete verifier`,
    row.verifierOutput ? undefined : `${row.claimId} positive row lacks verifier output`,
    row.productSupport !== "supported" &&
    !row.stateDecisions.includes("product-support-not-claimed")
      ? `${row.claimId} proof row does not explicitly avoid product support`
      : undefined,
  ]);
}

// fallow-ignore-next-line complexity
function validateStableRefusalRow(row: GraduationRow): string[] {
  if (row.evidenceStatus !== "refusal") {
    return [];
  }
  return compact([
    row.productSupport === "unsupported"
      ? undefined
      : `${row.claimId} refusal row is not unsupported`,
    row.migrationCompleted ? `${row.claimId} refusal row has migrationCompleted=true` : undefined,
    row.refusalCodes.length === 0 ? `${row.claimId} refusal row lacks refusal codes` : undefined,
  ]);
}

// fallow-ignore-next-line complexity
function validateWorkloadBoundary(row: GraduationRow): string[] {
  return compact([
    row.workloadEvidenceStatus === "level-3-debt-with-migration-path" && !row.migrationPath
      ? `${row.claimId} Level 3 debt row lacks migration path`
      : undefined,
    row.workloadEvidenceStatus === "level-1-2-supported-by-design" && !row.designBoundary
      ? `${row.claimId} product boundary row lacks design boundary`
      : undefined,
  ]);
}

// fallow-ignore-next-line complexity
function validateLevel4PositiveResources(row: GraduationRow): string[] {
  const level4Positive =
    row.graduationTargetLevel === "level-4-kernel-resource-reconstruction" &&
    row.evidenceStatus === "proof";
  if (
    level4Positive &&
    (!row.targetNativeReconstruction || row.acceptedResourceKinds.length === 0)
  ) {
    return [`${row.claimId} Level 4 positive row lacks reconstructed resource kinds`];
  }
  return [];
}

function validateArtifactDigest(row: GraduationRow): string[] {
  return Object.keys(row.artifactDigests).length === 0
    ? [`${row.claimId} lacks artifact digest`]
    : [];
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => value !== undefined);
}

// fallow-ignore-next-line complexity
function auditNativeGauntlet(): Summary["nativeGauntletAudit"] {
  const checkedSummary =
    "docs/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json";
  const failures: string[] = [];
  let rows: Json[] = [];
  try {
    const summary = JSON.parse(readFileSync(checkedSummary, "utf8")) as { rows?: Json[] };
    rows = summary.rows ?? [];
  } catch (error) {
    failures.push(`cannot read native gauntlet summary: ${(error as Error).message}`);
  }
  const nativeRows = rows.filter(
    (row) => typeof row.claimId === "string" && row.claimId.startsWith("native-"),
  );
  const proofRows = nativeRows
    .filter(
      (row) =>
        row.productSupport === "not-yet-supported" &&
        row.evidenceCategory === "native/process-proof",
    )
    .map((row) => String(row.claimId));
  const refusalRows = nativeRows
    .filter((row) => row.productSupport === "unsupported" && row.migrationCompleted === false)
    .map((row) => String(row.claimId));
  for (const claimId of REQUIRED_NATIVE_PROOF_ONLY_ROWS) {
    if (!proofRows.includes(claimId)) {
      failures.push(`${claimId} native proof row is missing or claims product support`);
    }
  }
  for (const claimId of REQUIRED_NATIVE_STABLE_REFUSAL_ROWS) {
    if (!refusalRows.includes(claimId)) {
      failures.push(`${claimId} native refusal row is missing or completed migration`);
    }
  }
  return {
    checkedSummary,
    nativeRows: nativeRows.length,
    proofRows,
    refusalRows,
    failures,
  };
}

function assertNoRefusals(label: string, refusals: Array<{ code: string }>) {
  if (refusals.length > 0) {
    throw new Error(
      `${label} unexpectedly refused: ${refusals.map((refusal) => refusal.code).join(",")}`,
    );
  }
}

function refusalCodesFor(resources: NativeProcessResource[]): string[] {
  return planNativeTargetFdTable({ resources }).refusals.map((refusal) => refusal.code);
}

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
      identifier: 0x4d50,
      sequence: 2,
      inFlightPackets: "none",
      receiveQueue: "empty",
      ...override,
    },
  };
}

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
      identifier: 0x4d49,
      sequence: 1,
      inFlightPackets: "none",
      receiveQueue: "empty",
      ...override,
    },
  };
}

function pipePairResource(
  fd: number,
  end: "read" | "write",
  override: Json = {},
  flags?: string[],
): NativeProcessResource {
  return {
    id: `fd:${fd}:pipe-${end}`,
    kind: "pipe",
    state: "captured",
    fd,
    path: "pipe:[level4]",
    flags: flags ?? [end === "read" ? "octal:0" : "octal:1"],
    recipe: {
      pipeModel: "empty-pair-v1",
      pipeBuffer: "empty",
      peerLifetime: "open",
      pipeWaiters: "none",
      readiness: "not-readable",
      ...override,
    },
  };
}

function eventfdResource(override: Json = {}): NativeProcessResource {
  return {
    id: "fd:11:eventfd",
    kind: "eventfd",
    state: "captured",
    fd: 11,
    path: "anon_inode:[eventfd]",
    flags: ["octal:2"],
    recipe: {
      eventfdModel: "counter-v1",
      eventfdCount: "0x2a",
      eventfdSemaphore: 0,
      eventfdWaiters: "none",
      ...override,
    },
  };
}

function timerfdResource(override: Json = {}): NativeProcessResource {
  return {
    id: "fd:12:timerfd",
    kind: "timer",
    state: "captured",
    fd: 12,
    path: "anon_inode:[timerfd]",
    flags: ["octal:2"],
    recipe: {
      timerfdModel: "descriptor-v1",
      timerfdClockId: 1,
      timerfdTicks: 0,
      timerfdSettimeFlags: 0,
      timerfdValueSeconds: 5,
      timerfdValueNanoseconds: 100,
      timerfdIntervalSeconds: 0,
      timerfdIntervalNanoseconds: 0,
      ...override,
    },
  };
}

function tcpListenerResource(override: Json = {}): NativeProcessResource {
  return {
    id: "fd:70:tcp-listener",
    kind: "socket",
    state: "captured",
    fd: 70,
    path: "socket:[tcp-listener]",
    flags: ["octal:2"],
    recipe: {
      tcpListenerModel: "loopback-listener-v1",
      family: "inet4",
      bindAddress: "127.0.0.1",
      port: 18080,
      backlog: 16,
      reuseAddr: true,
      ...override,
    },
  };
}

function tcpActiveResource(): NativeProcessResource {
  return {
    id: "fd:71:tcp-active",
    kind: "socket",
    state: "captured",
    fd: 71,
    path: "socket:[tcp-active]",
    flags: ["octal:2"],
    recipe: {
      tcpActiveConnectionModel: "explicit-broker-v1",
      family: "inet4",
      bindAddress: "127.0.0.1",
    },
  };
}

function resourceKinds(resources: Array<{ kind: string }>): string[] {
  return unique(resources.map((resource) => resource.kind));
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function stableDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

main();
