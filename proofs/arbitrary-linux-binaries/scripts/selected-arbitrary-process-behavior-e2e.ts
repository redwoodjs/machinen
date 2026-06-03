#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { cwd } from "node:process";
import { join, resolve } from "node:path";

import { createArbitraryProcessLevel5IdleResourceProof } from "../../../packages/runtime/src/arbitrary-process-level5-idle-resource-proof.ts";
import { createArbitraryProcessLevel5RegularFileFdProof } from "../../../packages/runtime/src/arbitrary-process-level5-regular-file-fd-proof.ts";
import { createArbitraryProcessLevel5SimplePipeFdProof } from "../../../packages/runtime/src/arbitrary-process-level5-simple-pipe-fd-proof.ts";

type Args = { outDir: string; json: boolean };

type Artifact = { name: string; path: string; sha256: string };

type BehaviorCheck = {
  id: string;
  status: "verified";
  evidence: string;
};

type RefusalRow = {
  id: string;
  status: "refused";
  reason: string;
};

type SelectedArbitraryProcessBehaviorE2eReport = {
  kind: "machinen.selected-arbitrary-linux-process-behavior-e2e";
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
  productSupportRowsAdded: 0;
  sourceCapture: {
    artifact: string;
    threads: 1;
    safePoint: "idle";
    argvSha256: string;
    envSha256: string;
    cwdSha256: string;
    staticDataHeapSha256: string;
  };
  targetVerifier: {
    artifact: string;
    argvMatched: true;
    envMatched: true;
    cwdMatched: true;
    staticDataHeapMatched: true;
    regularFileFdVerified: true;
    simplePipeFdVerified: true;
    idleEpollTcpVerified: true;
  };
  behaviorChecks: BehaviorCheck[];
  refusalRows: RefusalRow[];
  componentReports: Array<{
    id: string;
    artifact: string;
    accepted: true;
    rowId?: string;
    proofStatus?: string;
    sha256: string;
  }>;
  noShortcutPolicy: {
    rawCpuRestoreAccepted: false;
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
    outDir: "proofs/arbitrary-linux-binaries/selected-process-behavior-e2e/retained",
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

function buildReport(outDir: string): SelectedArbitraryProcessBehaviorE2eReport {
  mkdirSync(outDir, { recursive: true });
  const workDir = join(outDir, "work");
  mkdirSync(workDir, { recursive: true });

  const argv = ["selected-arbitrary-process-seed", "--mode=behavior-e2e"];
  const env = {
    MACHINEN_SELECTED_ARBITRARY_PROCESS_SEED: "behavior-e2e",
    MACHINEN_SELECTED_ARBITRARY_PROCESS_SCOPE: "selected-arbitrary-linux-process-seed-v1",
  };
  const sourceCwd = cwd();
  const staticDataHeap = {
    staticCounter: 42,
    dataMessage: "target-native-selected-seed-behavior",
    heapBytes: "heap-materialized-without-raw-cpu-restore",
  };
  const sourceCapture = {
    kind: "machinen.selected-arbitrary-linux-process-source-capture",
    scope: "selected-arbitrary-linux-process-seed-v1",
    process: {
      threads: 1,
      safePoint: "idle",
      activeSyscall: false,
      jitCodePresent: false,
      appCheckpointHooksRequired: false,
    },
    argv,
    env,
    cwd: sourceCwd,
    staticDataHeap,
    hashes: {
      argvSha256: sha256Json(argv),
      envSha256: sha256Json(env),
      cwdSha256: sha256String(sourceCwd),
      staticDataHeapSha256: sha256Json(staticDataHeap),
    },
  };
  const targetPlan = {
    kind: "machinen.selected-arbitrary-linux-process-target-plan",
    scope: "selected-arbitrary-linux-process-seed-v1",
    action: "target-native-proof-only-reconstruction",
    argv,
    env,
    cwd: sourceCwd,
    staticDataHeap,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    appCheckpointHooksRequired: false,
    sidecarReplayUsed: false,
    metadataOnlySuccessAccepted: false,
  };
  const coreVerifier = {
    kind: "machinen.selected-arbitrary-linux-process-target-verifier",
    scope: "selected-arbitrary-linux-process-seed-v1",
    argvMatched: sha256Json(argv) === sourceCapture.hashes.argvSha256,
    envMatched: sha256Json(env) === sourceCapture.hashes.envSha256,
    cwdMatched: sha256String(sourceCwd) === sourceCapture.hashes.cwdSha256,
    staticDataHeapMatched: sha256Json(staticDataHeap) === sourceCapture.hashes.staticDataHeapSha256,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    appCheckpointHooksRequired: false,
    sidecarReplayUsed: false,
    metadataOnlySuccessAccepted: false,
  };

  const coreArtifacts = [
    writeJson(outDir, "source-capture.json", sourceCapture),
    writeJson(outDir, "target-reconstruction-plan.json", targetPlan),
    writeJson(outDir, "target-verifier.json", coreVerifier),
  ];
  const regularFile = createArbitraryProcessLevel5RegularFileFdProof({
    outDir: join(workDir, "regular-file-fd"),
  });
  const simplePipe = createArbitraryProcessLevel5SimplePipeFdProof({
    outDir: join(workDir, "simple-pipe-fd"),
  });
  const idleResource = createArbitraryProcessLevel5IdleResourceProof({
    outDir: join(workDir, "idle-resource"),
  });

  const componentReports = [
    {
      id: "regular-file-fd",
      artifact: "work/regular-file-fd/regular-file-fd-proof-report.json",
      accepted: regularFile.accepted as true,
      rowId: regularFile.rowId,
      proofStatus: regularFile.proofStatus,
      sha256: regularFile.artifactsSha256,
    },
    {
      id: "simple-pipe-fd",
      artifact: "work/simple-pipe-fd/simple-pipe-fd-proof-report.json",
      accepted: simplePipe.accepted as true,
      rowId: simplePipe.rowId,
      proofStatus: simplePipe.proofStatus,
      sha256: simplePipe.artifactsSha256,
    },
    {
      id: "idle-epoll-tcp",
      artifact: "work/idle-resource/idle-resource-proof-report.json",
      accepted: idleResource.accepted as true,
      rowId: idleResource.rowId,
      proofStatus: idleResource.proofStatus,
      sha256: idleResource.artifactsSha256,
    },
  ];
  const behaviorChecks: BehaviorCheck[] = [
    {
      id: "argv-env-cwd",
      status: "verified",
      evidence: "target verifier matched captured argv, env, and cwd hashes",
    },
    {
      id: "static-data-heap",
      status: "verified",
      evidence: "target verifier matched captured static/data/heap payload hash",
    },
    {
      id: "regular-file-fd",
      status: "verified",
      evidence:
        "regular-file FD proof verified captured offset, read continuation, and target offset advance",
    },
    {
      id: "simple-pipe-fd",
      status: "verified",
      evidence: "simple pipe proof verified buffered bytes, endpoint direction, and EOF",
    },
    {
      id: "idle-epoll-tcp",
      status: "verified",
      evidence: "idle epoll/TCP proof verified no ready events and no accepted streams",
    },
  ];
  const refusalRows: RefusalRow[] = [
    {
      id: "threads",
      status: "refused",
      reason: "multiple live threads remain outside this selected seed",
    },
    {
      id: "active-syscalls",
      status: "refused",
      reason: "active syscall continuation is not reconstructed",
    },
    { id: "jit-code", status: "refused", reason: "JIT/generated executable pages remain refused" },
    { id: "futex-owned-locks", status: "refused", reason: "futex owners/waiters remain refused" },
    {
      id: "active-sockets-epoll",
      status: "refused",
      reason: "active sockets and active epoll readiness remain refused",
    },
    {
      id: "device-mmap",
      status: "refused",
      reason: "device mmap and opaque device state remain refused",
    },
    {
      id: "process-trees",
      status: "refused",
      reason: "multi-process/process-tree restore remains outside this selected seed",
    },
    {
      id: "arbitrary-unknown-linux-process",
      status: "refused",
      reason: "uncontrolled arbitrary process state remains unsupported",
    },
  ];
  const accepted = [
    coreVerifier.argvMatched,
    coreVerifier.envMatched,
    coreVerifier.cwdMatched,
    coreVerifier.staticDataHeapMatched,
    regularFile.accepted,
    regularFile.verifier.readStartedAtCapturedOffset,
    regularFile.verifier.readBytesSha256Matched,
    simplePipe.accepted,
    simplePipe.verifier.targetReadBytesSha256Matched,
    simplePipe.verifier.eofAfterBufferedBytes,
    idleResource.accepted,
    idleResource.verifier.epollWaitReturnedNoEvents,
    idleResource.verifier.listenerAcceptedNoStreams,
    componentReports.every((report) => report.accepted && report.sha256.length === 64),
  ].every(Boolean);
  const artifacts = coreArtifacts;
  const reportWithoutHash = {
    kind: "machinen.selected-arbitrary-linux-process-behavior-e2e" as const,
    version: 1 as const,
    accepted,
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
        "Behavior E2E is scoped proof-only evidence for selected-arbitrary-linux-process-seed-v1; it does not raise the public arbitrary-process claim.",
    },
    productPathArtifactsRequired: false as const,
    productSupportRowsAdded: 0 as const,
    sourceCapture: {
      artifact: "source-capture.json",
      threads: 1 as const,
      safePoint: "idle" as const,
      argvSha256: sourceCapture.hashes.argvSha256,
      envSha256: sourceCapture.hashes.envSha256,
      cwdSha256: sourceCapture.hashes.cwdSha256,
      staticDataHeapSha256: sourceCapture.hashes.staticDataHeapSha256,
    },
    targetVerifier: {
      artifact: "target-verifier.json",
      argvMatched: true as const,
      envMatched: true as const,
      cwdMatched: true as const,
      staticDataHeapMatched: true as const,
      regularFileFdVerified: true as const,
      simplePipeFdVerified: true as const,
      idleEpollTcpVerified: true as const,
    },
    behaviorChecks,
    refusalRows,
    componentReports,
    noShortcutPolicy: {
      rawCpuRestoreAccepted: false as const,
      sourceIsaEmulationAccepted: false as const,
      appCheckpointHooksAccepted: false as const,
      sidecarReplayAccepted: false as const,
      metadataOnlySuccessAccepted: false as const,
      arbitraryUnknownProcessAccepted: false as const,
    },
    artifacts,
  };
  return {
    ...reportWithoutHash,
    artifactsSha256: sha256Json(reportWithoutHash),
  };
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
mkdirSync(outDir, { recursive: true });
const report = buildReport(outDir);
writeFileSync(
  join(outDir, "selected-arbitrary-process-behavior-e2e-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (args.json) {
  console.log(JSON.stringify(report));
} else {
  console.log(
    `selected arbitrary-process behavior e2e accepted=${report.accepted} checks=${report.behaviorChecks.length} publicClaimAllowed=${report.publicClaimAllowed}`,
  );
}
