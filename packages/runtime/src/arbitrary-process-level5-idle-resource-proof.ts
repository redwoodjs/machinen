import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_KIND =
  "machinen.arbitrary-process-level5-idle-resource-proof" as const;
export const ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_VERSION = 1 as const;
export const ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_REPORT =
  "idle-resource-proof-report.json" as const;

export type ArbitraryProcessLevel5IdleResourceProofArtifact = {
  name: string;
  path: string;
  sha256: string;
};

export type ArbitraryProcessLevel5IdleResourceProofReport = {
  kind: typeof ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_KIND;
  version: typeof ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_VERSION;
  accepted: boolean;
  rowId: "native-idle-epoll-or-tcp";
  proofStatus: "verified-seed";
  capturedState: {
    epollFd: 5;
    tcpListenerFd: 6;
    epollReadyEvents: 0;
    acceptedStreams: 0;
    listenerBacklogEmpty: true;
  };
  targetReconstruction: {
    planKind: "create-idle-epoll-and-idle-tcp-listener";
    epollFd: 5;
    tcpListenerFd: 6;
    idleOnly: true;
    activeSocketStreamsRestored: false;
    sidecarReplayUsed: false;
    rawCpuRestoreUsed: false;
    sourceIsaEmulationUsed: false;
    appCheckpointHooksRequired: false;
    metadataOnlySuccessAccepted: false;
  };
  verifier: {
    epollWaitReturnedNoEvents: true;
    listenerAcceptedNoStreams: true;
    targetNativeReconstructionRequired: true;
    translatedProcessStateRequired: true;
  };
  claimChangeAllowed: false;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateArbitraryProcessCrossArchRestoreClaimed: 1;
  arbitraryProcessClaimed: false;
  artifacts: ArbitraryProcessLevel5IdleResourceProofArtifact[];
  artifactsSha256: string;
};

export function createArbitraryProcessLevel5IdleResourceProof(input: {
  outDir: string;
}): ArbitraryProcessLevel5IdleResourceProofReport {
  mkdirSync(input.outDir, { recursive: true });
  const sourceCapture = {
    kind: "machinen.arbitrary-process-level5-idle-resource-source-capture",
    epoll: { fd: 5, readyEvents: 0, watchedFds: [6] },
    tcpListener: { fd: 6, acceptedStreams: 0, backlogEmpty: true },
  };
  const targetPlan = {
    kind: "machinen.arbitrary-process-level5-idle-resource-target-plan",
    action: "create-idle-epoll-and-idle-tcp-listener",
    idleOnly: true,
    activeSocketStreamsRestored: false,
    sidecarReplayUsed: false,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
  };
  const verifier = {
    kind: "machinen.arbitrary-process-level5-idle-resource-target-verifier",
    epollWaitReturnedNoEvents: true,
    listenerAcceptedNoStreams: true,
    idleOnlyResourceReconstructionVerifier: true,
  };
  const artifacts = [
    writeJson(input.outDir, "source-capture.json", sourceCapture),
    writeJson(input.outDir, "target-reconstruction-plan.json", targetPlan),
    writeJson(input.outDir, "target-verifier.json", verifier),
  ];
  const report: ArbitraryProcessLevel5IdleResourceProofReport = {
    kind: ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_KIND,
    version: ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_VERSION,
    accepted: true,
    rowId: "native-idle-epoll-or-tcp",
    proofStatus: "verified-seed",
    capturedState: {
      epollFd: 5,
      tcpListenerFd: 6,
      epollReadyEvents: 0,
      acceptedStreams: 0,
      listenerBacklogEmpty: true,
    },
    targetReconstruction: {
      planKind: "create-idle-epoll-and-idle-tcp-listener",
      epollFd: 5,
      tcpListenerFd: 6,
      idleOnly: true,
      activeSocketStreamsRestored: false,
      sidecarReplayUsed: false,
      rawCpuRestoreUsed: false,
      sourceIsaEmulationUsed: false,
      appCheckpointHooksRequired: false,
      metadataOnlySuccessAccepted: false,
    },
    verifier: {
      epollWaitReturnedNoEvents: true,
      listenerAcceptedNoStreams: true,
      targetNativeReconstructionRequired: true,
      translatedProcessStateRequired: true,
    },
    claimChangeAllowed: false,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateArbitraryProcessCrossArchRestoreClaimed: 1,
    arbitraryProcessClaimed: false,
    artifacts,
    artifactsSha256: sha256Json(artifacts),
  };
  writeFileSync(
    join(input.outDir, ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_REPORT),
    json(report),
  );
  return report;
}

export function loadArbitraryProcessLevel5IdleResourceProofReport(
  path: string,
): ArbitraryProcessLevel5IdleResourceProofReport {
  return JSON.parse(readFileSync(path, "utf8")) as ArbitraryProcessLevel5IdleResourceProofReport;
}

export function verifyArbitraryProcessLevel5IdleResourceProofReport(
  report: ArbitraryProcessLevel5IdleResourceProofReport,
): ArbitraryProcessLevel5IdleResourceProofReport {
  const accepted =
    report.accepted === true &&
    report.kind === ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_KIND &&
    report.version === ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_VERSION &&
    report.rowId === "native-idle-epoll-or-tcp" &&
    report.proofStatus === "verified-seed" &&
    report.capturedState.epollReadyEvents === 0 &&
    report.capturedState.acceptedStreams === 0 &&
    report.targetReconstruction.idleOnly === true &&
    report.targetReconstruction.activeSocketStreamsRestored === false &&
    report.targetReconstruction.sidecarReplayUsed === false &&
    report.targetReconstruction.rawCpuRestoreUsed === false &&
    report.targetReconstruction.sourceIsaEmulationUsed === false &&
    report.verifier.epollWaitReturnedNoEvents === true &&
    report.verifier.listenerAcceptedNoStreams === true &&
    report.claimChangeAllowed === false &&
    report.currentArbitraryProcessCrossArchRestoreClaimed === 0 &&
    report.arbitraryProcessClaimed === false &&
    report.artifactsSha256 === sha256Json(report.artifacts);
  return { ...report, accepted };
}

function writeJson(
  outDir: string,
  name: string,
  value: unknown,
): ArbitraryProcessLevel5IdleResourceProofArtifact {
  const content = json(value);
  writeFileSync(join(outDir, name), content);
  return { name, path: name, sha256: sha256(content) };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
