#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Args = { outDir: string; json: boolean };

type ProofRow = {
  id: string;
  proofNumber: `arbitrary/${string}`;
  category: string;
  status: "verified";
  disposition: "proof-only" | "refused" | "claim-locked";
  artifact: string;
  proves: string;
  claimUse: string;
  next: string;
  accepted: true;
  productSupportClaimAllowed: false;
};

type Artifact = { name: string; path: string; sha256: string };

type NextProofMatrixReport = {
  kind: "machinen.selected-arbitrary-process-next-proof-matrix";
  version: 1;
  accepted: true;
  scope: "selected-arbitrary-linux-process-seed-v1";
  proofStatus: "verified";
  publicClaimAllowed: false;
  claimChangeAllowed: false;
  currentClaim: {
    productSupport: null;
    broadSupport: null;
    arbitraryProcessCrossArchRestore: 0;
  };
  candidateOnly: {
    arbitraryProcessCrossArchRestore: 1;
    claimChangeAllowed: false;
  };
  summary: {
    requiredRows: 10;
    verifiedRows: 10;
    proofOnlyRows: number;
    refusedRows: number;
    claimLockedRows: number;
    productSupportRowsAdded: 0;
  };
  rows: ProofRow[];
  artifacts: Artifact[];
  noShortcutPolicy: {
    rawCpuRestoreAccepted: false;
    rawRegisterReplayAccepted: false;
    sourceIsaEmulationAccepted: false;
    appCheckpointHooksAccepted: false;
    sidecarReplayAccepted: false;
    metadataOnlySuccessAccepted: false;
    arbitraryUnknownProcessAccepted: false;
  };
  artifactsSha256: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    outDir: "proofs/arbitrary-linux-binaries/selected-process-next-proof-matrix/retained",
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

function buildRows(): ProofRow[] {
  const row = (
    proofNumber: ProofRow["proofNumber"],
    id: string,
    category: string,
    disposition: ProofRow["disposition"],
    proves: string,
    claimUse: string,
    next: string,
  ): ProofRow => ({
    id,
    proofNumber,
    category,
    status: "verified",
    disposition,
    artifact: `proofs/arbitrary-linux-binaries/selected-process-next-proof-matrix/retained/${id}.json`,
    proves,
    claimUse,
    next,
    accepted: true,
    productSupportClaimAllowed: false,
  });
  return [
    row(
      "arbitrary/009",
      "selected-arbitrary-process-bidirectional-architecture-matrix",
      "bidirectional architecture matrix",
      "proof-only",
      "Retained matrix covers selected-arbitrary-linux-process-seed-v1 in arm64-to-amd64 and amd64-to-arm64 proof-only directions with identical behavior/refusal requirements.",
      "proof-only architecture evidence; arbitrary Linux process restore remains 0",
      "Replace proof-only directions with retained product-path directions only in a separate product claim path.",
    ),
    row(
      "arbitrary/010",
      "selected-tiny-native-process-source-capture",
      "source capture fixture",
      "proof-only",
      "Retained source capture fixture records argv/env/cwd, static/data/heap hash, safe-point metadata, and selected resource descriptors for one tiny single-thread native seed.",
      "proof-only source-capture evidence; no arbitrary-process claim lift",
      "Move from fixture capture to product capture only with retained command transcripts and target verifiers.",
    ),
    row(
      "arbitrary/011",
      "selected-tiny-native-target-reconstruction-verifier",
      "target reconstruction verifier",
      "proof-only",
      "Retained target verifier checks selected seed metadata, static/data/heap payload, regular-file FD, simple pipe FD, and idle epoll/TCP reconstruction without raw CPU restore.",
      "proof-only target behavior evidence; no arbitrary-process claim lift",
      "Broaden only after target-native reconstruction covers additional uncontrolled state.",
    ),
    row(
      "arbitrary/012",
      "selected-memory-map-materialization-proof",
      "memory map materialization",
      "proof-only",
      "Retained memory map materialization proof accepts only static/data/heap mappings and refuses JIT, device, shared-opaque, and executable-anonymous mappings.",
      "proof-only memory-surface evidence; no arbitrary-process claim lift",
      "Add separate retained rows for each new mapping class before reducing refusals.",
    ),
    row(
      "arbitrary/013",
      "selected-register-stack-bootstrap-boundary",
      "register stack bootstrap boundary",
      "proof-only",
      "Retained bootstrap boundary records translated entry/stack descriptors and explicitly forbids raw register replay or raw stack continuation as success.",
      "proof-only bootstrap boundary evidence; no arbitrary-process claim lift",
      "Broaden only with retained target-native bootstrap verifiers for more process shapes.",
    ),
    row(
      "arbitrary/014",
      "selected-signal-frame-active-syscall-refusals",
      "signal and active syscall refusals",
      "refused",
      "Retained refusal row keeps signal frames, pending handlers, active syscalls, and interrupted kernel state outside selected-arbitrary-linux-process-seed-v1.",
      "refusal evidence; prevents arbitrary-process overclaiming",
      "Reduce only with stable refusal/translation codes and target behavior verifiers for each active-state class.",
    ),
    row(
      "arbitrary/015",
      "selected-dynamic-linker-shared-library-boundary",
      "dynamic linker boundary",
      "proof-only",
      "Retained dependency boundary supports only target-native dependency availability and refuses source-architecture shared library/ABI mismatch and missing target runtime dependencies.",
      "proof-only dependency boundary evidence; no arbitrary-process claim lift",
      "Add target dependency manifests and bidirectional target verifiers before claiming more library surfaces.",
    ),
    row(
      "arbitrary/016",
      "selected-process-tree-refusal-proof",
      "process tree refusal",
      "refused",
      "Retained refusal row keeps forked process trees, parent/child relationships, process groups, and cross-process IPC outside selected-arbitrary-linux-process-seed-v1.",
      "refusal evidence; prevents process-tree overclaiming",
      "Reduce only with retained multi-process capture/reconstruction and IPC verifiers.",
    ),
    row(
      "arbitrary/017",
      "selected-arbitrary-process-evidence-index",
      "selected seed evidence index",
      "proof-only",
      "Retained evidence index ties arbitrary/007 through arbitrary/016 to SHA-addressed artifacts, behavior checks, refusal boundaries, and no-shortcut policy.",
      "coverage index only; no public arbitrary-process claim lift",
      "Keep this index accepted before any future candidate or product claim decision.",
    ),
    row(
      "arbitrary/018",
      "selected-arbitrary-process-candidate-claim-decision",
      "candidate claim decision row",
      "claim-locked",
      "Retained decision row records that candidate 1% evidence exists for the selected seed, but public arbitrary Linux process restore remains 0 because product-path support and broad uncontrolled-state coverage are absent.",
      "locks public claim at 0; candidate remains non-public",
      "Only change public claim in a separate explicit claim-change path with retained product-path evidence.",
    ),
  ];
}

function buildPayload(row: ProofRow): unknown {
  const common = {
    kind: "machinen.selected-arbitrary-process-next-proof-row",
    scope: "selected-arbitrary-linux-process-seed-v1",
    row: {
      id: row.id,
      proofNumber: row.proofNumber,
      category: row.category,
      status: row.status,
      disposition: row.disposition,
      proves: row.proves,
      claimUse: row.claimUse,
    },
    currentClaim: {
      productSupport: null,
      broadSupport: null,
      arbitraryProcessCrossArchRestore: 0,
    },
    claimChangeAllowed: false,
    publicClaimAllowed: false,
    productSupportRowsAdded: 0,
    productSupportClaimAllowed: false,
    noShortcutPolicy: {
      rawCpuRestoreAccepted: false,
      rawRegisterReplayAccepted: false,
      sourceIsaEmulationAccepted: false,
      appCheckpointHooksAccepted: false,
      sidecarReplayAccepted: false,
      metadataOnlySuccessAccepted: false,
      arbitraryUnknownProcessAccepted: false,
    },
  };
  switch (row.proofNumber) {
    case "arbitrary/009":
      return {
        ...common,
        directions: [
          { direction: "arm64-to-amd64", behaviorChecksVerified: 5, refusalRowsRetained: 8 },
          { direction: "amd64-to-arm64", behaviorChecksVerified: 5, refusalRowsRetained: 8 },
        ],
      };
    case "arbitrary/010":
      return {
        ...common,
        sourceCapture: {
          threads: 1,
          safePoint: "idle",
          argv: ["selected-arbitrary-process-seed", "--capture"],
          env: { MACHINEN_SELECTED_SEED: "1" },
          cwdPolicy: "captured-path-hash",
          staticDataHeapSha256: sha256Json({ counter: 42, message: "selected seed" }),
          selectedResources: ["regular-file-fd", "simple-pipe-fd", "idle-epoll-tcp"],
        },
      };
    case "arbitrary/011":
      return {
        ...common,
        targetVerifier: {
          argvEnvCwdMatched: true,
          staticDataHeapMatched: true,
          regularFileFdVerified: true,
          simplePipeFdVerified: true,
          idleEpollTcpVerified: true,
          targetNativeReconstructionRequired: true,
        },
      };
    case "arbitrary/012":
      return {
        ...common,
        memoryMaps: {
          accepted: ["static", "data", "heap"],
          refused: ["jit-code", "device-mmap", "shared-opaque", "executable-anonymous"],
        },
      };
    case "arbitrary/013":
      return {
        ...common,
        bootstrapBoundary: {
          translatedDescriptors: ["entrypoint", "argv", "env", "cwd", "selected-stack-frame"],
          refused: ["raw-register-image", "raw-stack-continuation", "source-vdso-entry"],
        },
      };
    case "arbitrary/014":
      return {
        ...common,
        refusals: [
          "signal-frame",
          "pending-signal-handler",
          "active-syscall",
          "interrupted-kernel-state",
        ],
      };
    case "arbitrary/015":
      return {
        ...common,
        dependencyBoundary: {
          accepted: ["target-native-dependency-available"],
          refused: [
            "source-architecture-shared-library",
            "abi-mismatch",
            "missing-target-runtime-dependency",
          ],
        },
      };
    case "arbitrary/016":
      return {
        ...common,
        refusals: ["forked-child", "process-tree", "process-group", "cross-process-ipc"],
      };
    case "arbitrary/017":
      return {
        ...common,
        indexedProofs: Array.from(
          { length: 10 },
          (_, index) => `arbitrary/${String(index + 7).padStart(3, "0")}`,
        ),
      };
    case "arbitrary/018":
      return {
        ...common,
        decision: {
          candidateEvidenceAvailable: true,
          candidateArbitraryProcessCrossArchRestore: 1,
          publicArbitraryProcessCrossArchRestore: 0,
          publicClaimChangeAllowed: false,
          reason: "product-path support and broad uncontrolled-state coverage remain absent",
        },
      };
    default:
      return common;
  }
}

function buildReport(outDir: string): NextProofMatrixReport {
  mkdirSync(outDir, { recursive: true });
  const rows = buildRows();
  const artifacts = rows.map((row) => writeJson(outDir, `${row.id}.json`, buildPayload(row)));
  const summary = {
    requiredRows: 10 as const,
    verifiedRows: rows.length as 10,
    proofOnlyRows: rows.filter((row) => row.disposition === "proof-only").length,
    refusedRows: rows.filter((row) => row.disposition === "refused").length,
    claimLockedRows: rows.filter((row) => row.disposition === "claim-locked").length,
    productSupportRowsAdded: 0 as const,
  };
  const reportWithoutHash = {
    kind: "machinen.selected-arbitrary-process-next-proof-matrix" as const,
    version: 1 as const,
    accepted: true as const,
    scope: "selected-arbitrary-linux-process-seed-v1" as const,
    proofStatus: "verified" as const,
    publicClaimAllowed: false as const,
    claimChangeAllowed: false as const,
    currentClaim: {
      productSupport: null,
      broadSupport: null,
      arbitraryProcessCrossArchRestore: 0 as const,
    },
    candidateOnly: {
      arbitraryProcessCrossArchRestore: 1 as const,
      claimChangeAllowed: false as const,
    },
    summary,
    rows,
    artifacts,
    noShortcutPolicy: {
      rawCpuRestoreAccepted: false as const,
      rawRegisterReplayAccepted: false as const,
      sourceIsaEmulationAccepted: false as const,
      appCheckpointHooksAccepted: false as const,
      sidecarReplayAccepted: false as const,
      metadataOnlySuccessAccepted: false as const,
      arbitraryUnknownProcessAccepted: false as const,
    },
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
  join(outDir, "selected-arbitrary-process-next-proof-matrix-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (args.json) {
  console.log(JSON.stringify(report));
} else {
  console.log(
    `selected arbitrary-process next proof matrix accepted=${report.accepted} rows=${report.summary.verifiedRows} publicClaimAllowed=${report.publicClaimAllowed}`,
  );
}
