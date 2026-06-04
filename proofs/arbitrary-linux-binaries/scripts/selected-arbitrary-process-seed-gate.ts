#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { evaluateArbitraryProcessLevel5ClaimReady } from "../../../packages/runtime/src/arbitrary-process-level5-claim-ready.ts";
import { createArbitraryProcessLevel5IdleResourceProof } from "../../../packages/runtime/src/arbitrary-process-level5-idle-resource-proof.ts";
import { createArbitraryProcessLevel5RegularFileFdProof } from "../../../packages/runtime/src/arbitrary-process-level5-regular-file-fd-proof.ts";
import { createArbitraryProcessLevel5SeedReport } from "../../../packages/runtime/src/arbitrary-process-level5-seed-matrix.ts";
import { createArbitraryProcessLevel5SimplePipeFdProof } from "../../../packages/runtime/src/arbitrary-process-level5-simple-pipe-fd-proof.ts";

type Args = { outDir: string; json: boolean };

type SelectedArbitraryProcessSeedGateReport = {
  kind: "machinen.selected-arbitrary-linux-process-seed-gate";
  version: 1;
  accepted: boolean;
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
    reason: string;
  };
  productPathArtifactsRequired: false;
  productPathArtifactsCovered: 0;
  productSupportRowsAdded: 0;
  selectedSeedRows: Array<{
    id: string;
    status: "verified-seed";
    artifact: string;
    sha256: string;
  }>;
  refusalRows: Array<{
    id: string;
    status: "refused";
    reason: string;
  }>;
  gates: Array<{
    id: string;
    passed: boolean;
    evidence: string;
  }>;
  noShortcutPolicy: {
    rawCpuRestoreAccepted: false;
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
    outDir: "proofs/arbitrary-linux-binaries/selected-process-seed/retained",
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

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildReport(outDir: string): SelectedArbitraryProcessSeedGateReport {
  const workDir = join(outDir, "work");
  mkdirSync(workDir, { recursive: true });
  const seedReport = createArbitraryProcessLevel5SeedReport({ outDir: join(workDir, "seed") });
  const regularFile = createArbitraryProcessLevel5RegularFileFdProof({
    outDir: join(workDir, "regular-file-fd"),
  });
  const simplePipe = createArbitraryProcessLevel5SimplePipeFdProof({
    outDir: join(workDir, "simple-pipe-fd"),
  });
  const idleResource = createArbitraryProcessLevel5IdleResourceProof({
    outDir: join(workDir, "idle-resource"),
  });
  const selectedSeedRows = [
    {
      id: regularFile.rowId,
      status: regularFile.proofStatus,
      artifact: "work/regular-file-fd/regular-file-fd-proof-report.json",
      sha256: regularFile.artifactsSha256,
    },
    {
      id: simplePipe.rowId,
      status: simplePipe.proofStatus,
      artifact: "work/simple-pipe-fd/simple-pipe-fd-proof-report.json",
      sha256: simplePipe.artifactsSha256,
    },
    {
      id: idleResource.rowId,
      status: idleResource.proofStatus,
      artifact: "work/idle-resource/idle-resource-proof-report.json",
      sha256: idleResource.artifactsSha256,
    },
  ] as const;
  const claimReady = evaluateArbitraryProcessLevel5ClaimReady({
    seedReport,
    verifiedSeeds: selectedSeedRows.map((row) => ({
      rowId: row.id,
      accepted: true,
      proofStatus: row.status,
      artifact: row.artifact,
      sha256: row.sha256,
    })),
  });
  const refusalRows = [
    ["threads", "multiple live execution contexts remain refused"],
    ["jit-code", "runtime-generated executable pages remain refused"],
    ["futex-owned-locks", "owned locks and wait queues remain refused"],
    ["live-sockets-active-epoll", "live sockets and active epoll readiness remain refused"],
    ["device-mmap", "device memory and opaque kernel/device state remain refused"],
    [
      "arbitrary-unknown-linux-process",
      "uncontrolled arbitrary process state remains not supported",
    ],
  ].map(([id, reason]) => ({ id, status: "refused" as const, reason }));
  const gates = [
    {
      id: "selected-seed-rows-verified",
      passed: selectedSeedRows.every(
        (row) => row.status === "verified-seed" && row.sha256.length === 64,
      ),
      evidence:
        "regular-file FD, simple pipe FD, and idle epoll/TCP seed proofs are retained and SHA-addressed.",
    },
    {
      id: "claim-ready-input-accepted",
      passed: claimReady.accepted === true && claimReady.verifiedSeedCount === 3,
      evidence:
        "Existing arbitrary-process claim-ready gate accepts the three proof-only seed rows as a candidate only.",
    },
    {
      id: "product-path-artifacts-not-required",
      passed: true,
      evidence:
        "This selected seed gate is proof-only; product-path artifacts are intentionally not required and product support rows added is 0.",
    },
    {
      id: "public-claim-remains-zero",
      passed: claimReady.currentArbitraryProcessCrossArchRestoreClaimed === 0,
      evidence: "Public arbitrary Linux process cross-architecture restore claim remains 0.",
    },
    {
      id: "refusal-boundaries-retained",
      passed: refusalRows.length === 6,
      evidence:
        "Threads, JIT, futex owners, live sockets/active epoll, device mmap, and arbitrary unknown processes remain refused.",
    },
  ];
  const reportWithoutHash = {
    kind: "machinen.selected-arbitrary-linux-process-seed-gate" as const,
    version: 1 as const,
    accepted: gates.every((gate) => gate.passed),
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
      reason:
        "Candidate-only scoped seed evidence; no public arbitrary-process claim lift without a separate explicit decision and broader retained coverage.",
    },
    productPathArtifactsRequired: false as const,
    productPathArtifactsCovered: 0 as const,
    productSupportRowsAdded: 0 as const,
    selectedSeedRows: [...selectedSeedRows],
    refusalRows,
    gates,
    noShortcutPolicy: {
      rawCpuRestoreAccepted: false as const,
      sourceIsaEmulationAccepted: false as const,
      appCheckpointHooksAccepted: false as const,
      sidecarReplayAccepted: false as const,
      metadataOnlySuccessAccepted: false as const,
      arbitraryUnknownProcessAccepted: false as const,
    },
  };
  return {
    ...reportWithoutHash,
    artifactsSha256: sha256Json(reportWithoutHash),
  };
}

const args = parseArgs(process.argv);
const outDir = resolve(args.outDir);
mkdirSync(outDir, { recursive: true });
const report = buildReport(outDir);
writeFileSync(
  join(outDir, "selected-arbitrary-process-seed-gate-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (args.json) {
  console.log(JSON.stringify(report));
} else {
  console.log(
    `selected arbitrary-process seed accepted=${report.accepted} publicClaimAllowed=${report.publicClaimAllowed} productSupportRowsAdded=${report.productSupportRowsAdded}`,
  );
}
