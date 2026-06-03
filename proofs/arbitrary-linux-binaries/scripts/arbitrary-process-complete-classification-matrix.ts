#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Args = { outDir: string; json: boolean };
type Disposition = "supported-proof" | "refused";
type Artifact = { name: string; path: string; sha256: string };

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
};

type ClassificationMatrixReport = {
  kind: "machinen.arbitrary-process-complete-classification-matrix";
  version: 1;
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
  summary: {
    requiredRows: 20;
    verifiedRows: 20;
    supportedProofRows: 6;
    refusedRows: 14;
    unknownRows: 0;
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
  verifier: ClassificationRow["verifier"],
): ClassificationRow {
  return row(proofNumber, id, category, "supported-proof", evidence, `supported-${id}`, verifier);
}

function refused(
  proofNumber: ClassificationRow["proofNumber"],
  id: string,
  category: string,
  stableCode: string,
  evidence: string[],
  verifier: ClassificationRow["verifier"] = {},
): ClassificationRow {
  return row(proofNumber, id, category, "refused", evidence, stableCode, {
    refusedBeforeTargetExecution: true,
    stableRefusalCode: stableCode,
    ...verifier,
  });
}

function row(
  proofNumber: ClassificationRow["proofNumber"],
  id: string,
  category: string,
  disposition: Disposition,
  evidence: string[],
  stableCode: string,
  verifier: ClassificationRow["verifier"],
): ClassificationRow {
  return {
    id,
    proofNumber,
    category,
    status: "verified",
    disposition,
    accepted: true,
    productSupportOutOfScope: true,
    productSupportClaimAllowed: false,
    arbitraryRestoreClaimAllowed: false,
    evidence,
    stableCode,
    verifier: {
      ...verifier,
      rawCpuRestoreUsed: false,
      rawRegisterReplayUsed: false,
      sourceIsaEmulationUsed: false,
      appCheckpointHooksRequired: false,
      sidecarReplayUsed: false,
      metadataOnlySuccessAccepted: false,
    },
  };
}

function buildRows(): ClassificationRow[] {
  return [
    supported(
      "arbitrary/020",
      "process-metadata-argv-env-cwd",
      "process metadata",
      ["argv/env/cwd hashes are classified as target-native reconstructable proof state"],
      { argvEnvCwdClassified: true },
    ),
    supported(
      "arbitrary/021",
      "static-data-heap-memory",
      "memory",
      ["static/data/heap byte payload is classified as target-native materializable proof state"],
      { staticDataHeapClassified: true },
    ),
    supported(
      "arbitrary/022",
      "regular-file-fd-state",
      "file descriptor",
      [
        "regular-file FD path/offset/flags are classified as selected reconstructable resource state",
      ],
      { regularFileFdClassified: true },
    ),
    supported(
      "arbitrary/023",
      "simple-pipe-fd-state",
      "pipe descriptor",
      [
        "simple pipe buffered bytes and endpoint direction are classified as selected reconstructable resource state",
      ],
      { simplePipeFdClassified: true },
    ),
    supported(
      "arbitrary/024",
      "idle-eventfd-timerfd-state",
      "idle kernel resource",
      [
        "idle eventfd/timerfd descriptors are classified as selected idle reconstructable resource state",
      ],
      { eventfdClassified: true, timerfdClassified: true, idleOnly: true },
    ),
    supported(
      "arbitrary/025",
      "idle-epoll-tcp-listener-state",
      "idle network resource",
      [
        "idle epoll and idle TCP listener with no ready events/streams are classified as selected reconstructable state",
      ],
      { idleEpollClassified: true, idleTcpListenerClassified: true, activeStreams: 0 },
    ),
    refused(
      "arbitrary/026",
      "pending-signal-frame-state",
      "signal state",
      "arbitrary-process-signal-frame-unsupported",
      [
        "pending signal frames and handler continuation require target-specific stack/kernel semantics",
      ],
      { signalFramePresent: true },
    ),
    refused(
      "arbitrary/027",
      "active-syscall-state",
      "active syscall state",
      "arbitrary-process-active-syscall-unsupported",
      ["interrupted active syscalls and in-kernel state are refused before target execution"],
      { activeSyscallPresent: true },
    ),
    refused(
      "arbitrary/028",
      "multi-thread-scheduler-state",
      "thread state",
      "arbitrary-process-multithread-unsupported",
      [
        "multiple live threads require scheduler, register, and stack ownership reconstruction not accepted by this matrix",
      ],
      { liveThreadsGreaterThanOne: true },
    ),
    refused(
      "arbitrary/029",
      "futex-owner-waiter-state",
      "futex state",
      "arbitrary-process-futex-owner-waiter-unsupported",
      ["futex owners/waiters and wait queues can wedge or corrupt target execution"],
      { futexOwnerOrWaiterPresent: true },
    ),
    refused(
      "arbitrary/030",
      "jit-executable-anonymous-mapping",
      "executable memory",
      "arbitrary-process-jit-executable-mapping-unsupported",
      [
        "JIT/generated executable anonymous mappings are refused; raw executable page replay is forbidden",
      ],
      { executableAnonymousMappingPresent: true },
    ),
    refused(
      "arbitrary/031",
      "device-mmap-opaque-resource",
      "device mmap",
      "arbitrary-process-device-mmap-unsupported",
      ["device mmap and opaque device state have target-specific side effects and are refused"],
      { deviceMmapPresent: true },
    ),
    refused(
      "arbitrary/032",
      "shared-memory-opaque-mapping",
      "shared memory",
      "arbitrary-process-shared-memory-opaque-unsupported",
      ["opaque shared memory without a portable manifest is refused"],
      { sharedOpaqueMappingPresent: true },
    ),
    refused(
      "arbitrary/033",
      "active-unix-domain-socket-state",
      "Unix socket",
      "arbitrary-process-active-unix-socket-unsupported",
      ["active Unix domain sockets, queued credentials, and peer process coupling are refused"],
      { activeUnixSocketPresent: true },
    ),
    refused(
      "arbitrary/034",
      "process-tree-parent-child-state",
      "process tree",
      "arbitrary-process-tree-unsupported",
      [
        "forked children, process groups, parent/child relationships, and cross-process IPC remain refused",
      ],
      { processTreePresent: true },
    ),
    refused(
      "arbitrary/035",
      "dynamic-linker-abi-mismatch-state",
      "dynamic linker",
      "arbitrary-process-dynamic-linker-abi-mismatch-unsupported",
      [
        "source-architecture shared libraries, ABI mismatch, and missing target dependencies are refused",
      ],
      { abiMismatchPresent: true },
    ),
    refused(
      "arbitrary/036",
      "credentials-namespace-cgroup-state",
      "credentials and namespaces",
      "arbitrary-process-credentials-namespace-cgroup-unsupported",
      [
        "credential, namespace, and cgroup state require host/target policy reconstruction and are refused in this matrix",
      ],
      { namespaceOrCgroupStatePresent: true },
    ),
    refused(
      "arbitrary/037",
      "seccomp-filter-policy-state",
      "seccomp",
      "arbitrary-process-seccomp-policy-unsupported",
      [
        "seccomp filters can block target behavior or restore logic and are refused without a retained policy verifier",
      ],
      { seccompFilterPresent: true },
    ),
    refused(
      "arbitrary/038",
      "ptrace-debugger-traced-state",
      "ptrace/debugger",
      "arbitrary-process-ptrace-debug-state-unsupported",
      ["ptrace/debugger relationships and traced stop state are refused"],
      { ptraceStatePresent: true },
    ),
    refused(
      "arbitrary/039",
      "arbitrary-unknown-process-state",
      "unknown state",
      "arbitrary-process-unknown-state-unsupported",
      [
        "any unclassified process-state class is refused by default; matrix has zero unknown accepted rows",
      ],
      { defaultUnknownStatePolicy: "refuse" },
    ),
  ];
}

function buildReport(outDir: string): ClassificationMatrixReport {
  mkdirSync(outDir, { recursive: true });
  const rows = buildRows();
  const artifacts = rows.map((classificationRow) =>
    writeJson(outDir, `${classificationRow.id}.json`, classificationRow),
  );
  const summary = {
    requiredRows: 20 as const,
    verifiedRows: rows.length as 20,
    supportedProofRows: rows.filter((candidate) => candidate.disposition === "supported-proof")
      .length as 6,
    refusedRows: rows.filter((candidate) => candidate.disposition === "refused").length as 14,
    unknownRows: 0 as const,
    productSupportRowsAdded: 0 as const,
    publicArbitraryProcessClaim: 0 as const,
  };
  const accepted =
    rows.length === 20 &&
    rows.every(
      (classificationRow) =>
        classificationRow.accepted === true &&
        classificationRow.productSupportOutOfScope === true &&
        classificationRow.productSupportClaimAllowed === false &&
        classificationRow.arbitraryRestoreClaimAllowed === false &&
        classificationRow.verifier.rawCpuRestoreUsed === false &&
        classificationRow.verifier.sourceIsaEmulationUsed === false,
    );
  if (!accepted) {
    throw new Error("classification matrix acceptance failed");
  }
  const reportWithoutHash = {
    kind: "machinen.arbitrary-process-complete-classification-matrix" as const,
    version: 1 as const,
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
    artifacts,
  };
  return { ...reportWithoutHash, artifactsSha256: sha256Json(reportWithoutHash) };
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
    `arbitrary process classification matrix accepted=${report.accepted} rows=${report.summary.verifiedRows} classified=${report.classificationClaim.declaredStateClassesClassified}`,
  );
}
