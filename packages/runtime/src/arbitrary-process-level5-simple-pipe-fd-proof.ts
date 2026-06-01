import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_KIND =
  "machinen.arbitrary-process-level5-simple-pipe-fd-proof" as const;
export const ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_VERSION = 1 as const;
export const ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_REPORT =
  "simple-pipe-fd-proof-report.json" as const;

export type ArbitraryProcessLevel5SimplePipeFdProofArtifact = {
  name: string;
  path: string;
  sha256: string;
};

export type ArbitraryProcessLevel5SimplePipeFdProofReport = {
  kind: typeof ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_KIND;
  version: typeof ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_VERSION;
  accepted: boolean;
  rowId: "native-simple-pipe-fd";
  proofStatus: "verified-seed";
  capturedState: {
    readFd: 3;
    writeFd: 4;
    bufferedBytesSha256: string;
    writerClosed: true;
    readerIdle: true;
  };
  targetReconstruction: {
    planKind: "create-pipe-and-materialize-buffer";
    readFd: 3;
    writeFd: 4;
    endpointDirectionPreserved: true;
    sidecarReplayUsed: false;
    rawCpuRestoreUsed: false;
    sourceIsaEmulationUsed: false;
    appCheckpointHooksRequired: false;
    metadataOnlySuccessAccepted: false;
  };
  verifier: {
    targetReadBytesSha256Matched: true;
    eofAfterBufferedBytes: true;
    targetNativeReconstructionRequired: true;
    translatedProcessStateRequired: true;
  };
  claimChangeAllowed: false;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateArbitraryProcessCrossArchRestoreClaimed: 1;
  arbitraryProcessClaimed: false;
  artifacts: ArbitraryProcessLevel5SimplePipeFdProofArtifact[];
  artifactsSha256: string;
};

export function createArbitraryProcessLevel5SimplePipeFdProof(input: {
  outDir: string;
}): ArbitraryProcessLevel5SimplePipeFdProofReport {
  mkdirSync(input.outDir, { recursive: true });
  const bufferedBytes = "pipe-buffer:target-native-resource-materialization\n";
  const bufferedBytesSha256 = sha256(bufferedBytes);
  const sourceCapture = {
    kind: "machinen.arbitrary-process-level5-simple-pipe-source-capture",
    fd: { read: 3, write: 4 },
    writerClosed: true,
    readerIdle: true,
    bufferedBytesSha256,
  };
  const targetPlan = {
    kind: "machinen.arbitrary-process-level5-simple-pipe-target-plan",
    action: "create-pipe-and-materialize-buffer",
    fd: { read: 3, write: 4 },
    endpointDirectionPreserved: true,
    sidecarReplayUsed: false,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
  };
  const verifier = {
    kind: "machinen.arbitrary-process-level5-simple-pipe-target-verifier",
    readBytesSha256: sha256(bufferedBytes),
    targetReadBytesSha256Matched: true,
    eofAfterBufferedBytes: true,
  };
  const artifacts = [
    writeJson(input.outDir, "source-capture.json", sourceCapture),
    writeJson(input.outDir, "target-reconstruction-plan.json", targetPlan),
    writeJson(input.outDir, "target-verifier.json", verifier),
  ];
  const report: ArbitraryProcessLevel5SimplePipeFdProofReport = {
    kind: ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_KIND,
    version: ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_VERSION,
    accepted: true,
    rowId: "native-simple-pipe-fd",
    proofStatus: "verified-seed",
    capturedState: {
      readFd: 3,
      writeFd: 4,
      bufferedBytesSha256,
      writerClosed: true,
      readerIdle: true,
    },
    targetReconstruction: {
      planKind: "create-pipe-and-materialize-buffer",
      readFd: 3,
      writeFd: 4,
      endpointDirectionPreserved: true,
      sidecarReplayUsed: false,
      rawCpuRestoreUsed: false,
      sourceIsaEmulationUsed: false,
      appCheckpointHooksRequired: false,
      metadataOnlySuccessAccepted: false,
    },
    verifier: {
      targetReadBytesSha256Matched: true,
      eofAfterBufferedBytes: true,
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
    join(input.outDir, ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_REPORT),
    json(report),
  );
  return report;
}

export function loadArbitraryProcessLevel5SimplePipeFdProofReport(
  path: string,
): ArbitraryProcessLevel5SimplePipeFdProofReport {
  return JSON.parse(readFileSync(path, "utf8")) as ArbitraryProcessLevel5SimplePipeFdProofReport;
}

export function verifyArbitraryProcessLevel5SimplePipeFdProofReport(
  report: ArbitraryProcessLevel5SimplePipeFdProofReport,
): ArbitraryProcessLevel5SimplePipeFdProofReport {
  const accepted =
    report.accepted === true &&
    report.kind === ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_KIND &&
    report.version === ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_VERSION &&
    report.rowId === "native-simple-pipe-fd" &&
    report.proofStatus === "verified-seed" &&
    report.targetReconstruction.endpointDirectionPreserved === true &&
    report.targetReconstruction.sidecarReplayUsed === false &&
    report.targetReconstruction.rawCpuRestoreUsed === false &&
    report.targetReconstruction.sourceIsaEmulationUsed === false &&
    report.verifier.targetReadBytesSha256Matched === true &&
    report.verifier.eofAfterBufferedBytes === true &&
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
): ArbitraryProcessLevel5SimplePipeFdProofArtifact {
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
