#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Args = { outDir: string; json: boolean };

type PhaseStatus = "blocked" | "defined" | "proof-only" | "not-started";
type Artifact = { name: string; path: string; sha256: string };

type PhaseRow = {
  id: string;
  proofNumber: `arbitrary-phase/${string}`;
  title: string;
  targetClaim: {
    productSupport: number | null;
    broadSupport: number;
    arbitraryProcessCrossArchRestore: number;
  };
  status: PhaseStatus;
  claimChangeAllowed: false;
  productPathRequired: false;
  productPathCovered: false;
  retainedEvidence: string[];
  missingGates: string[];
  blockers: string[];
  claimUse: string;
  next: string;
};

type PhaseLadderReport = {
  kind: "machinen.arbitrary-process-100-phase-ladder";
  version: 1;
  accepted: true;
  publicClaimAllowed: false;
  claimChangeAllowed: false;
  currentClaim: {
    productSupport: null;
    broadSupport: null;
    arbitraryProcessCrossArchRestore: 0;
  };
  targetClaim: {
    productSupport: null;
    broadSupport: 100;
    arbitraryProcessCrossArchRestore: 100;
  };
  summary: {
    phaseRows: 7;
    completedClaimRows: 0;
    proofOnlyRows: number;
    blockedRows: number;
    notStartedRows: number;
    productSupportRowsAdded: 0;
    publicArbitraryProcessClaim: 0;
  };
  phases: PhaseRow[];
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
    outDir: "proofs/arbitrary-linux-binaries/100-phase-ladder/retained",
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

function phaseRows(): PhaseRow[] {
  const row = (
    id: string,
    proofNumber: PhaseRow["proofNumber"],
    title: string,
    targetClaim: PhaseRow["targetClaim"],
    status: PhaseStatus,
    productPathRequired: false,
    retainedEvidence: string[],
    missingGates: string[],
    blockers: string[],
    next: string,
  ): PhaseRow => ({
    id,
    proofNumber,
    title,
    targetClaim,
    status,
    claimChangeAllowed: false,
    productPathRequired,
    productPathCovered: false,
    retainedEvidence,
    missingGates,
    blockers,
    claimUse: "phase definition/evidence only; public arbitrary Linux process restore remains 0",
    next,
  });
  return [
    row(
      "phase-1-selected-seed-proof-path",
      "arbitrary-phase/001",
      "1 / 1 selected seed proof path",
      { productSupport: null, broadSupport: 1, arbitraryProcessCrossArchRestore: 1 },
      "proof-only",
      false,
      [
        "arbitrary/007 selected seed gate",
        "arbitrary/008 selected behavior E2E",
        "arbitrary/009-arbitrary/018 proof/refusal matrix",
      ],
      ["none for proof-only phase 1; product support is out of scope"],
      [],
      "Keep as proof-backed selected seed evidence; do not require product-path artifacts.",
    ),
    row(
      "phase-2-controlled-process-corpus",
      "arbitrary-phase/002",
      "5 / 1 controlled process proof corpus",
      { productSupport: null, broadSupport: 5, arbitraryProcessCrossArchRestore: 1 },
      "proof-only",
      false,
      [
        "argv/env/cwd proof",
        "regular-file FD proof",
        "simple-pipe FD proof",
        "idle epoll/TCP proof",
      ],
      [
        "retained proof matrix for multiple controlled binaries",
        "bidirectional target verifiers for each row",
        "row coverage manifest with no unknown rows",
      ],
      ["controlled process corpus rows beyond the selected seed are not complete"],
      "Build controlled-binary proof corpus without product-path requirements.",
    ),
    row(
      "phase-3-memory-dynamic-linker-signals",
      "arbitrary-phase/003",
      "20 / 5 memory, linker, and signal proof coverage",
      { productSupport: null, broadSupport: 20, arbitraryProcessCrossArchRestore: 5 },
      "proof-only",
      false,
      [
        "arbitrary/012 memory map materialization proof",
        "arbitrary/014 active syscall/signal refusals",
        "arbitrary/015 dynamic linker boundary",
      ],
      [
        "real mapping manifests from captured processes",
        "target dependency manifests",
        "stable signal/active-syscall refusal artifacts",
      ],
      ["JIT/device/shared-opaque mappings remain refused"],
      "Attach real process capture artifacts and target verifier transcripts for memory/linker rows.",
    ),
    row(
      "phase-4-process-tree-ipc-resource-classes",
      "arbitrary-phase/004",
      "40 / 10 process tree, IPC, and resource proof classes",
      { productSupport: null, broadSupport: 40, arbitraryProcessCrossArchRestore: 10 },
      "defined",
      false,
      ["arbitrary/016 process tree refusal proof"],
      [
        "retained process-tree capture/reconstruction proof artifacts",
        "IPC matrix for Unix sockets, pipes, eventfd, timerfd, shared memory",
        "namespace/cgroup/credential boundary matrix",
      ],
      ["process trees and cross-process IPC remain refused"],
      "Define and retain IPC/resource corpus rows before reducing process-tree refusal.",
    ),
    row(
      "phase-5-threads-futex-safe-subset",
      "arbitrary-phase/005",
      "60 / 20 threads/futex proof subset or hard refusals",
      { productSupport: null, broadSupport: 60, arbitraryProcessCrossArchRestore: 20 },
      "blocked",
      false,
      ["thread/futex refusal rows"],
      [
        "captured thread register/stack ownership model",
        "target-native scheduler/bootstrap verifier",
        "futex owner/waiter translation or stable refusal codes",
      ],
      ["multiple live threads and futex-owned locks remain refused"],
      "Do not reduce thread/futex boundaries without retained target-native thread behavior verifiers.",
    ),
    row(
      "phase-6-broad-linux-binary-corpus",
      "arbitrary-phase/006",
      "80 / 50 broad Linux binary proof corpus under strict gates",
      { productSupport: null, broadSupport: 80, arbitraryProcessCrossArchRestore: 50 },
      "not-started",
      false,
      [],
      [
        "coreutils/shell/server/interpreter corpus",
        "per-row source captures and target verifiers",
        "unsupported runtime/private-state refusal matrix",
        "artifact integrity manifest for every row",
      ],
      ["no broad uncontrolled binary corpus exists"],
      "Start only after controlled process and resource proof matrices are retained.",
    ),
    row(
      "phase-7-arbitrary-process-proof-100-gate",
      "arbitrary-phase/007",
      "100 / 100 arbitrary process proof/classification gate",
      { productSupport: null, broadSupport: 100, arbitraryProcessCrossArchRestore: 100 },
      "not-started",
      false,
      [],
      [
        "complete support/refusal matrix for every declared process-state class",
        "zero unknown rows",
        "bidirectional proof artifacts for every supported row",
        "stable refusal artifacts for every refused row",
        "external shortcut audit showing no raw CPU restore/source ISA emulation/metadata-only success",
      ],
      ["arbitrary unknown Linux process state remains unsupported"],
      "Only this gate may authorize proof/classification 100 / 100; product support remains out of scope.",
    ),
  ];
}

function payload(row: PhaseRow): unknown {
  return {
    kind: "machinen.arbitrary-process-100-phase-row",
    row,
    currentClaim: {
      productSupport: null,
      broadSupport: null,
      arbitraryProcessCrossArchRestore: 0,
    },
    targetClaim: row.targetClaim,
    publicClaimAllowed: false,
    claimChangeAllowed: false,
    productSupportRowsAdded: 0,
    forbiddenShortcuts: [
      "raw-cpu-restore",
      "raw-register-replay",
      "source-isa-emulation",
      "app-checkpoint-hooks-as-source-of-truth",
      "sidecar-replay",
      "metadata-only-success",
    ],
  };
}

function buildReport(outDir: string): PhaseLadderReport {
  mkdirSync(outDir, { recursive: true });
  const phases = phaseRows();
  const artifacts = phases.map((phase) => writeJson(outDir, `${phase.id}.json`, payload(phase)));
  const summary = {
    phaseRows: 7 as const,
    completedClaimRows: 0 as const,
    proofOnlyRows: phases.filter((phase) => phase.status === "proof-only").length,
    blockedRows: phases.filter((phase) => phase.status === "blocked").length,
    notStartedRows: phases.filter((phase) => phase.status === "not-started").length,
    productSupportRowsAdded: 0 as const,
    publicArbitraryProcessClaim: 0 as const,
  };
  const reportWithoutHash = {
    kind: "machinen.arbitrary-process-100-phase-ladder" as const,
    version: 1 as const,
    accepted: true as const,
    publicClaimAllowed: false as const,
    claimChangeAllowed: false as const,
    currentClaim: {
      productSupport: null,
      broadSupport: null,
      arbitraryProcessCrossArchRestore: 0 as const,
    },
    targetClaim: {
      productSupport: null,
      broadSupport: 100 as const,
      arbitraryProcessCrossArchRestore: 100 as const,
    },
    summary,
    phases,
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
const report = buildReport(resolve(args.outDir));
writeFileSync(
  join(resolve(args.outDir), "arbitrary-process-100-phase-ladder-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (args.json) {
  console.log(JSON.stringify(report));
} else {
  console.log(
    `arbitrary-process 100 phase ladder accepted=${report.accepted} phases=${report.summary.phaseRows} publicClaim=${report.summary.publicArbitraryProcessClaim}`,
  );
}
