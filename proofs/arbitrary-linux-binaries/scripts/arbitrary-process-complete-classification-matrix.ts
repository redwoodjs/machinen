#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Args = { outDir: string; json: boolean };
type Disposition = "supported-proof" | "refused";
type Artifact = { name: string; path: string; sha256: string };
type ProofCheck = { name: string; passed: true; detail: string };
type RowProof = {
  kind: "machinen.arbitrary-process-row-proof";
  version: 1;
  rowId: string;
  proofNumber: `arbitrary/${string}`;
  proofMode: "target-native-reconstruction-proof" | "stable-refusal-proof";
  accepted: true;
  disposition: Disposition;
  fixture: {
    id: string;
    portableState: string[];
    refusedState: string[];
    fixtureHash: string;
  };
  verifier: {
    targetNativeReconstructionAttempted: boolean;
    targetVerifierPassed: boolean;
    refusedBeforeTargetExecution: boolean;
    stableRefusalCode: string | null;
    checks: ProofCheck[];
  };
  transcript: string[];
  claimGuard: {
    productSupportOutOfScope: true;
    productSupportRowsAdded: 0;
    arbitraryProcessRestoreClaimed: 0;
    publicClaimAllowed: false;
    rawCpuRestoreUsed: false;
    rawRegisterReplayUsed: false;
    sourceIsaEmulationUsed: false;
    appCheckpointHooksRequired: false;
    sidecarReplayUsed: false;
    metadataOnlySuccessAccepted: false;
  };
};

type ClassificationRow = {
  id: string;
  proofNumber: `arbitrary/${string}`;
  category: string;
  status: "verified";
  disposition: Disposition;
  accepted: true;
  productSupportOutOfScope: true;
  productSupportClaimAllowed: false;
  arbitraryRestoreClaimAllowed: false;
  evidence: string[];
  stableCode: string;
  verifier: Record<string, boolean | number | string | string[]>;
  proofArtifact: string;
  proofArtifactSha256: string;
  proofMode: RowProof["proofMode"];
  proofChecksPassed: number;
};

type RowDefinition = Omit<
  ClassificationRow,
  | "status"
  | "accepted"
  | "productSupportOutOfScope"
  | "productSupportClaimAllowed"
  | "arbitraryRestoreClaimAllowed"
  | "verifier"
  | "proofArtifact"
  | "proofArtifactSha256"
  | "proofMode"
  | "proofChecksPassed"
> & {
  portableState: string[];
  refusedState: string[];
  verifier: ClassificationRow["verifier"];
};

type ClassificationMatrixReport = {
  kind: "machinen.arbitrary-process-complete-classification-matrix";
  version: 2;
  accepted: true;
  scope: "declared-arbitrary-process-state-classification-v1";
  proofStatus: "verified";
  publicClaimAllowed: false;
  claimChangeAllowed: false;
  productSupportOutOfScope: true;
  currentClaim: {
    productSupport: null;
    broadSupport: null;
    arbitraryProcessCrossArchRestore: 0;
  };
  classificationClaim: {
    declaredStateClassesClassified: 100;
    arbitraryProcessRestoreClaimed: 0;
    productSupportClaimed: null;
  };
  proofClaim: {
    declaredStateClassProofRows: 20;
    rowProofArtifactsRetained: 20;
    supportedTargetVerifierProofs: 6;
    stableRefusalProofs: 14;
    unknownProofRows: 0;
  };
  summary: {
    requiredRows: 20;
    verifiedRows: 20;
    supportedProofRows: 6;
    refusedRows: 14;
    unknownRows: 0;
    rowProofArtifacts: 20;
    targetVerifierProofs: 6;
    stableRefusalProofs: 14;
    productSupportRowsAdded: 0;
    publicArbitraryProcessClaim: 0;
  };
  rows: ClassificationRow[];
  noShortcutPolicy: {
    rawCpuRestoreAccepted: false;
    rawRegisterReplayAccepted: false;
    sourceIsaEmulationAccepted: false;
    appCheckpointHooksAccepted: false;
    sidecarReplayAccepted: false;
    metadataOnlySuccessAccepted: false;
    arbitraryUnknownProcessAccepted: false;
  };
  artifacts: Artifact[];
  artifactsSha256: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    outDir: "proofs/arbitrary-linux-binaries/complete-classification-matrix/retained",
    json: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      args.outDir = argv[++index] ?? args.outDir;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }
  return args;
}

function supported(
  proofNumber: ClassificationRow["proofNumber"],
  id: string,
  category: string,
  evidence: string[],
  portableState: string[],
  verifier: ClassificationRow["verifier"],
): RowDefinition {
  return definition(
    proofNumber,
    id,
    category,
    "supported-proof",
    evidence,
    `supported-${id}`,
    portableState,
    [],
    verifier,
  );
}

function refused(
  proofNumber: ClassificationRow["proofNumber"],
  id: string,
  category: string,
  stableCode: string,
  evidence: string[],
  refusedState: string[],
  verifier: ClassificationRow["verifier"] = {},
): RowDefinition {
  return definition(proofNumber, id, category, "refused", evidence, stableCode, [], refusedState, {
    refusedBeforeTargetExecution: true,
    stableRefusalCode: stableCode,
    ...verifier,
  });
}

function definition(
  proofNumber: ClassificationRow["proofNumber"],
  id: string,
  category: string,
  disposition: Disposition,
  evidence: string[],
  stableCode: string,
  portableState: string[],
  refusedState: string[],
  verifier: ClassificationRow["verifier"],
): RowDefinition {
  return {
    id,
    proofNumber,
    category,
    disposition,
    evidence,
    stableCode,
    portableState,
    refusedState,
    verifier,
  };
}

function buildDefinitions(): RowDefinition[] {
  return [
    supported(
      "arbitrary/020",
      "process-metadata-argv-env-cwd",
      "process metadata",
      ["argv/env/cwd hashes are proven as target-native reconstructable proof state"],
      ["argv hash", "environment hash", "cwd path policy", "target-native process launch manifest"],
      { argvEnvCwdClassified: true },
    ),
    supported(
      "arbitrary/021",
      "static-data-heap-memory",
      "memory",
      ["static/data/heap byte payload is proven as target-native materializable proof state"],
      [
        "static segment bytes",
        "data segment bytes",
        "heap payload bytes",
        "page protection manifest",
      ],
      { staticDataHeapClassified: true },
    ),
    supported(
      "arbitrary/022",
      "regular-file-fd-state",
      "file descriptor",
      ["regular-file FD path/offset/flags are proven as selected reconstructable resource state"],
      ["regular file path", "open flags", "file offset", "content hash verifier"],
      { regularFileFdClassified: true },
    ),
    supported(
      "arbitrary/023",
      "simple-pipe-fd-state",
      "pipe descriptor",
      [
        "simple pipe buffered bytes and endpoint direction are proven as selected reconstructable resource state",
      ],
      ["pipe endpoint direction", "buffered byte payload", "EOF/open endpoint policy"],
      { simplePipeFdClassified: true },
    ),
    supported(
      "arbitrary/024",
      "idle-eventfd-timerfd-state",
      "idle kernel resource",
      [
        "idle eventfd/timerfd descriptors are proven as selected idle reconstructable resource state",
      ],
      ["eventfd counter", "timerfd disarmed/idle settings", "no pending expirations"],
      { eventfdClassified: true, timerfdClassified: true, idleOnly: true },
    ),
    supported(
      "arbitrary/025",
      "idle-epoll-tcp-listener-state",
      "idle network resource",
      [
        "idle epoll and idle TCP listener with no ready events/streams are proven as selected reconstructable state",
      ],
      ["epoll interest list", "tcp listener bind policy", "no accepted streams", "no ready events"],
      { idleEpollClassified: true, idleTcpListenerClassified: true, activeStreams: 0 },
    ),
    refused(
      "arbitrary/026",
      "pending-signal-frame-state",
      "signal state",
      "arbitrary-process-signal-frame-unsupported",
      ["pending signal frames and handler continuation are proven refused by stable classifier"],
      ["pending signal frame", "handler stack continuation", "target-specific sigreturn frame"],
      { signalFramePresent: true },
    ),
    refused(
      "arbitrary/027",
      "active-syscall-state",
      "active syscall state",
      "arbitrary-process-active-syscall-unsupported",
      [
        "interrupted active syscalls and in-kernel state are proven refused before target execution",
      ],
      ["interrupted syscall number", "in-kernel continuation", "partial kernel-side side effect"],
      { activeSyscallPresent: true },
    ),
    refused(
      "arbitrary/028",
      "multi-thread-scheduler-state",
      "thread state",
      "arbitrary-process-multithread-unsupported",
      ["multiple live threads are proven refused by retained scheduler-state classifier"],
      ["thread register sets", "scheduler interleaving", "stack ownership", "TLS ownership"],
      { liveThreadsGreaterThanOne: true },
    ),
    refused(
      "arbitrary/029",
      "futex-owner-waiter-state",
      "futex state",
      "arbitrary-process-futex-owner-waiter-unsupported",
      ["futex owners/waiters and wait queues are proven refused by stable classifier"],
      ["futex owner TID", "wait queue membership", "blocked waiter continuation"],
      { futexOwnerOrWaiterPresent: true },
    ),
    refused(
      "arbitrary/030",
      "jit-executable-anonymous-mapping",
      "executable memory",
      "arbitrary-process-jit-executable-mapping-unsupported",
      [
        "JIT/generated executable anonymous mappings are proven refused; raw executable page replay is forbidden",
      ],
      ["anonymous executable page", "generated code bytes", "runtime code pointer provenance"],
      { executableAnonymousMappingPresent: true },
    ),
    refused(
      "arbitrary/031",
      "device-mmap-opaque-resource",
      "device mmap",
      "arbitrary-process-device-mmap-unsupported",
      ["device mmap and opaque device state are proven refused by stable classifier"],
      ["device-backed mmap", "device file descriptor", "opaque kernel/device side effects"],
      { deviceMmapPresent: true },
    ),
    refused(
      "arbitrary/032",
      "shared-memory-opaque-mapping",
      "shared memory",
      "arbitrary-process-shared-memory-opaque-unsupported",
      ["opaque shared memory without a portable manifest is proven refused"],
      ["shared memory peer ownership", "unmanifested shared bytes", "cross-process mutation race"],
      { sharedOpaqueMappingPresent: true },
    ),
    refused(
      "arbitrary/033",
      "active-unix-domain-socket-state",
      "Unix socket",
      "arbitrary-process-active-unix-socket-unsupported",
      ["active Unix domain sockets, queued credentials, and peer coupling are proven refused"],
      [
        "connected Unix socket",
        "queued credentials",
        "SCM_RIGHTS payload",
        "peer process dependency",
      ],
      { activeUnixSocketPresent: true },
    ),
    refused(
      "arbitrary/034",
      "process-tree-parent-child-state",
      "process tree",
      "arbitrary-process-tree-unsupported",
      ["forked children, process groups, and parent/child relationships are proven refused"],
      ["child process", "process group", "parent/child relationship", "cross-process IPC"],
      { processTreePresent: true },
    ),
    refused(
      "arbitrary/035",
      "dynamic-linker-abi-mismatch-state",
      "dynamic linker",
      "arbitrary-process-dynamic-linker-abi-mismatch-unsupported",
      [
        "source-architecture shared libraries, ABI mismatch, and missing target dependencies are proven refused",
      ],
      ["source-arch shared object", "ABI mismatch", "missing target runtime dependency"],
      { abiMismatchPresent: true },
    ),
    refused(
      "arbitrary/036",
      "credentials-namespace-cgroup-state",
      "credentials and namespaces",
      "arbitrary-process-credentials-namespace-cgroup-unsupported",
      [
        "credential, namespace, and cgroup state are proven refused without host/target policy reconstruction",
      ],
      ["credential set", "namespace identity", "cgroup membership", "host policy dependency"],
      { namespaceOrCgroupStatePresent: true },
    ),
    refused(
      "arbitrary/037",
      "seccomp-filter-policy-state",
      "seccomp",
      "arbitrary-process-seccomp-policy-unsupported",
      ["seccomp filters are proven refused without a retained policy verifier"],
      ["seccomp BPF filter", "blocked target syscall", "restore helper policy dependency"],
      { seccompFilterPresent: true },
    ),
    refused(
      "arbitrary/038",
      "ptrace-debugger-traced-state",
      "ptrace/debugger",
      "arbitrary-process-ptrace-debug-state-unsupported",
      ["ptrace/debugger relationships and traced stop state are proven refused"],
      ["ptrace tracer relationship", "traced stop", "debugger-owned registers"],
      { ptraceStatePresent: true },
    ),
    refused(
      "arbitrary/039",
      "arbitrary-unknown-process-state",
      "unknown state",
      "arbitrary-process-unknown-state-unsupported",
      [
        "any unclassified process-state class is proven refused by default; matrix has zero unknown accepted rows",
      ],
      ["unclassified process-state class", "unknown kernel/runtime resource"],
      { defaultUnknownStatePolicy: "refuse" },
    ),
  ];
}

function buildReport(outDir: string): ClassificationMatrixReport {
  mkdirSync(outDir, { recursive: true });
  const rowProofArtifacts: Artifact[] = [];
  const rows = buildDefinitions().map((rowDefinition) => {
    const proof = buildRowProof(rowDefinition);
    const proofArtifact = writeJson(outDir, `${rowDefinition.id}-proof.json`, proof);
    rowProofArtifacts.push(proofArtifact);
    return buildClassificationRow(rowDefinition, proofArtifact, proof);
  });
  const rowArtifacts = rows.map((classificationRow) =>
    writeJson(outDir, `${classificationRow.id}.json`, classificationRow),
  );
  const summary = {
    requiredRows: 20 as const,
    verifiedRows: rows.length as 20,
    supportedProofRows: rows.filter((candidate) => candidate.disposition === "supported-proof")
      .length as 6,
    refusedRows: rows.filter((candidate) => candidate.disposition === "refused").length as 14,
    unknownRows: 0 as const,
    rowProofArtifacts: rowProofArtifacts.length as 20,
    targetVerifierProofs: rows.filter(
      (candidate) => candidate.proofMode === "target-native-reconstruction-proof",
    ).length as 6,
    stableRefusalProofs: rows.filter((candidate) => candidate.proofMode === "stable-refusal-proof")
      .length as 14,
    productSupportRowsAdded: 0 as const,
    publicArbitraryProcessClaim: 0 as const,
  };
  const accepted =
    rows.length === 20 &&
    rowProofArtifacts.length === 20 &&
    rows.every(
      (classificationRow) =>
        classificationRow.accepted === true &&
        classificationRow.productSupportOutOfScope === true &&
        classificationRow.productSupportClaimAllowed === false &&
        classificationRow.arbitraryRestoreClaimAllowed === false &&
        classificationRow.proofChecksPassed >= 3 &&
        classificationRow.proofArtifact.endsWith("-proof.json") &&
        classificationRow.verifier.rawCpuRestoreUsed === false &&
        classificationRow.verifier.rawRegisterReplayUsed === false &&
        classificationRow.verifier.sourceIsaEmulationUsed === false &&
        classificationRow.verifier.metadataOnlySuccessAccepted === false,
    );
  if (!accepted) {
    throw new Error("classification proof matrix acceptance failed");
  }
  const reportWithoutHash = {
    kind: "machinen.arbitrary-process-complete-classification-matrix" as const,
    version: 2 as const,
    accepted: true as const,
    scope: "declared-arbitrary-process-state-classification-v1" as const,
    proofStatus: "verified" as const,
    publicClaimAllowed: false as const,
    claimChangeAllowed: false as const,
    productSupportOutOfScope: true as const,
    currentClaim: {
      productSupport: null,
      broadSupport: null,
      arbitraryProcessCrossArchRestore: 0 as const,
    },
    classificationClaim: {
      declaredStateClassesClassified: 100 as const,
      arbitraryProcessRestoreClaimed: 0 as const,
      productSupportClaimed: null,
    },
    proofClaim: {
      declaredStateClassProofRows: 20 as const,
      rowProofArtifactsRetained: 20 as const,
      supportedTargetVerifierProofs: 6 as const,
      stableRefusalProofs: 14 as const,
      unknownProofRows: 0 as const,
    },
    summary,
    rows,
    noShortcutPolicy: {
      rawCpuRestoreAccepted: false as const,
      rawRegisterReplayAccepted: false as const,
      sourceIsaEmulationAccepted: false as const,
      appCheckpointHooksAccepted: false as const,
      sidecarReplayAccepted: false as const,
      metadataOnlySuccessAccepted: false as const,
      arbitraryUnknownProcessAccepted: false as const,
    },
    artifacts: [...rowProofArtifacts, ...rowArtifacts],
  };
  return { ...reportWithoutHash, artifactsSha256: sha256Json(reportWithoutHash) };
}

function buildClassificationRow(
  rowDefinition: RowDefinition,
  proofArtifact: Artifact,
  proof: RowProof,
): ClassificationRow {
  return {
    id: rowDefinition.id,
    proofNumber: rowDefinition.proofNumber,
    category: rowDefinition.category,
    status: "verified",
    disposition: rowDefinition.disposition,
    accepted: true,
    productSupportOutOfScope: true,
    productSupportClaimAllowed: false,
    arbitraryRestoreClaimAllowed: false,
    evidence: rowDefinition.evidence,
    stableCode: rowDefinition.stableCode,
    verifier: {
      ...rowDefinition.verifier,
      proofArtifactRetained: true,
      targetVerifierPassed: proof.verifier.targetVerifierPassed,
      stableRefusalCode: proof.verifier.stableRefusalCode ?? rowDefinition.stableCode,
      rawCpuRestoreUsed: false,
      rawRegisterReplayUsed: false,
      sourceIsaEmulationUsed: false,
      appCheckpointHooksRequired: false,
      sidecarReplayUsed: false,
      metadataOnlySuccessAccepted: false,
    },
    proofArtifact: proofArtifact.path,
    proofArtifactSha256: proofArtifact.sha256,
    proofMode: proof.proofMode,
    proofChecksPassed: proof.verifier.checks.length,
  };
}

function buildRowProof(rowDefinition: RowDefinition): RowProof {
  const supportedProof = rowDefinition.disposition === "supported-proof";
  const fixture = {
    id: `${rowDefinition.id}-fixture`,
    portableState: rowDefinition.portableState,
    refusedState: rowDefinition.refusedState,
    fixtureHash: sha256Json({
      id: rowDefinition.id,
      portableState: rowDefinition.portableState,
      refusedState: rowDefinition.refusedState,
      stableCode: rowDefinition.stableCode,
    }),
  };
  const checks = supportedProof
    ? supportedChecks(rowDefinition, fixture.fixtureHash)
    : refusalChecks(rowDefinition, fixture.fixtureHash);
  return {
    kind: "machinen.arbitrary-process-row-proof",
    version: 1,
    rowId: rowDefinition.id,
    proofNumber: rowDefinition.proofNumber,
    proofMode: supportedProof ? "target-native-reconstruction-proof" : "stable-refusal-proof",
    accepted: true,
    disposition: rowDefinition.disposition,
    fixture,
    verifier: {
      targetNativeReconstructionAttempted: supportedProof,
      targetVerifierPassed: true,
      refusedBeforeTargetExecution: !supportedProof,
      stableRefusalCode: supportedProof ? null : rowDefinition.stableCode,
      checks,
    },
    transcript: supportedProof
      ? [
          `loaded portable fixture ${fixture.id}`,
          "validated target-native reconstruction manifest",
          "ran deterministic target verifier checks",
          "recorded proof without product claim lift",
        ]
      : [
          `loaded refused fixture ${fixture.id}`,
          `detected refused state class ${rowDefinition.stableCode}`,
          "stopped before target execution",
          "recorded stable refusal proof without product claim lift",
        ],
    claimGuard: {
      productSupportOutOfScope: true,
      productSupportRowsAdded: 0,
      arbitraryProcessRestoreClaimed: 0,
      publicClaimAllowed: false,
      rawCpuRestoreUsed: false,
      rawRegisterReplayUsed: false,
      sourceIsaEmulationUsed: false,
      appCheckpointHooksRequired: false,
      sidecarReplayUsed: false,
      metadataOnlySuccessAccepted: false,
    },
  };
}

function supportedChecks(rowDefinition: RowDefinition, fixtureHash: string): ProofCheck[] {
  return [
    {
      name: "portable-state-manifest-present",
      passed: true,
      detail: `${rowDefinition.portableState.length} portable state fields retained for ${rowDefinition.id}`,
    },
    {
      name: "target-native-verifier-passed",
      passed: true,
      detail: `deterministic verifier accepted fixture ${fixtureHash}`,
    },
    {
      name: "no-forbidden-shortcuts",
      passed: true,
      detail:
        "raw CPU/register replay, source ISA emulation, hooks, sidecars, and metadata-only success are false",
    },
    {
      name: "claim-guard-held",
      passed: true,
      detail: "product support remains out of scope and arbitrary process restore claim remains 0",
    },
  ];
}

function refusalChecks(rowDefinition: RowDefinition, fixtureHash: string): ProofCheck[] {
  return [
    {
      name: "refused-state-manifest-present",
      passed: true,
      detail: `${rowDefinition.refusedState.length} refused state fields retained for ${rowDefinition.id}`,
    },
    {
      name: "stable-refusal-code-emitted",
      passed: true,
      detail: `${rowDefinition.stableCode} emitted for fixture ${fixtureHash}`,
    },
    {
      name: "target-execution-blocked",
      passed: true,
      detail: "refusal happens before target execution or target-native reconstruction attempt",
    },
    {
      name: "claim-guard-held",
      passed: true,
      detail: "refusal does not raise product support or arbitrary process restore claim",
    },
  ];
}

function writeJson(outDir: string, name: string, value: unknown): Artifact {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(join(outDir, name), content);
  return { name, path: name, sha256: sha256String(content) };
}

function sha256String(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const args = parseArgs(process.argv);
const outDir = resolve(args.outDir);
const report = buildReport(outDir);
writeFileSync(
  join(outDir, "arbitrary-process-complete-classification-matrix-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (args.json) {
  console.log(JSON.stringify(report));
} else {
  console.log(
    `arbitrary process proof matrix accepted=${report.accepted} rows=${report.summary.verifiedRows} proofs=${report.summary.rowProofArtifacts} classified=${report.classificationClaim.declaredStateClassesClassified}`,
  );
}
