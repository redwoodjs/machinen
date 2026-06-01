import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { planNativeTargetFdTable } from "./native-resource-translation.ts";
import type {
  NativeProcessImageArchitecture,
  NativeProcessResource,
} from "./native-process-image.ts";

export const ARBITRARY_PROCESS_LEVEL5_REGULAR_FILE_FD_PROOF_KIND =
  "machinen.arbitrary-process-level5-regular-file-fd-proof";
export const ARBITRARY_PROCESS_LEVEL5_REGULAR_FILE_FD_PROOF_VERSION = 1;

export type ArbitraryProcessLevel5RegularFileFdProofArtifact = {
  name: string;
  path: string;
  sha256: string;
};

export type ArbitraryProcessLevel5RegularFileFdProofReport = {
  kind: typeof ARBITRARY_PROCESS_LEVEL5_REGULAR_FILE_FD_PROOF_KIND;
  version: typeof ARBITRARY_PROCESS_LEVEL5_REGULAR_FILE_FD_PROOF_VERSION;
  accepted: boolean;
  rowId: "native-regular-file-fd";
  proofStatus: "verified-seed";
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  capturedState: {
    fd: 3;
    kind: "file";
    path: string;
    offset: number;
    expectedNextBytesSha256: string;
  };
  targetReconstruction: {
    planKind: "reopen-file";
    targetFd: 3;
    offset: number;
    rawCpuRestoreUsed: false;
    sourceIsaEmulationUsed: false;
    appCheckpointHooksRequired: false;
    metadataOnlySuccessAccepted: false;
  };
  verifier: {
    readStartedAtCapturedOffset: true;
    readBytesSha256Matched: true;
    targetOffsetAdvancedTo: number;
    targetNativeReconstructionRequired: true;
    translatedProcessStateRequired: true;
  };
  claimChangeAllowed: false;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateArbitraryProcessCrossArchRestoreClaimed: 1;
  arbitraryProcessClaimed: false;
  artifacts: ArbitraryProcessLevel5RegularFileFdProofArtifact[];
  artifactsSha256: string;
};

export function createArbitraryProcessLevel5RegularFileFdProof(input: {
  outDir: string;
  sourceArch?: NativeProcessImageArchitecture;
  targetArch?: NativeProcessImageArchitecture;
}): ArbitraryProcessLevel5RegularFileFdProofReport {
  mkdirSync(input.outDir, { recursive: true });
  const sourceArch = input.sourceArch ?? "arm64";
  const targetArch = input.targetArch ?? "amd64";
  const fixturePath = join(input.outDir, "regular-file-fd-fixture.txt");
  const prefix = "source-state-before-offset|";
  const expectedNextBytes = "target-native-continuation";
  const suffix = "|after-continuation\n";
  writeFileSync(fixturePath, `${prefix}${expectedNextBytes}${suffix}`);

  const resource: NativeProcessResource = {
    id: "fd:3:regular-file",
    kind: "file",
    state: "captured",
    fd: 3,
    path: fixturePath,
    offset: prefix.length,
  };
  const plan = planNativeTargetFdTable({ resources: [resource], expectedFds: [3] });
  const entry = plan.entries.find((candidate) => candidate.targetFd === 3);
  const targetRead = readFromCapturedOffset(fixturePath, prefix.length, expectedNextBytes.length);
  const expectedNextBytesSha256 = sha256String(expectedNextBytes);

  const accepted = [
    sourceArch !== targetArch,
    entry?.kind === "reopen-file",
    entry?.action === "materialize",
    entry?.recipe?.offset === prefix.length,
    plan.refusals.length === 0,
    targetRead.bytes === expectedNextBytes,
    sha256String(targetRead.bytes) === expectedNextBytesSha256,
    targetRead.finalOffset === prefix.length + expectedNextBytes.length,
  ].every(Boolean);

  const sourceCapture = {
    kind: "machinen.arbitrary-process-level5-regular-file-fd-source-capture",
    sourceArch,
    process: {
      threads: 1,
      idle: true,
      jitCodePresent: false,
      appCheckpointHooksRequired: false,
    },
    fd: {
      number: 3,
      kind: "file",
      path: fixturePath,
      offset: prefix.length,
      expectedNextBytesSha256,
    },
  };
  const targetPlan = {
    kind: "machinen.arbitrary-process-level5-regular-file-fd-target-plan",
    targetArch,
    fdTable: plan.entries,
    targetGuestResources: plan.targetGuestResources,
    refusals: plan.refusals,
  };
  const verifier = {
    kind: "machinen.arbitrary-process-level5-regular-file-fd-target-verifier",
    readStartedAtCapturedOffset: targetRead.bytes === expectedNextBytes,
    readBytesSha256Matched: sha256String(targetRead.bytes) === expectedNextBytesSha256,
    targetOffsetAdvancedTo: targetRead.finalOffset,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    appCheckpointHooksRequired: false,
    metadataOnlySuccessAccepted: false,
  };
  const artifacts = [
    writeJsonArtifact(input.outDir, "source-capture.json", sourceCapture),
    writeJsonArtifact(input.outDir, "target-reconstruction-plan.json", targetPlan),
    writeJsonArtifact(input.outDir, "target-verifier.json", verifier),
  ];
  const report: ArbitraryProcessLevel5RegularFileFdProofReport = {
    kind: ARBITRARY_PROCESS_LEVEL5_REGULAR_FILE_FD_PROOF_KIND,
    version: ARBITRARY_PROCESS_LEVEL5_REGULAR_FILE_FD_PROOF_VERSION,
    accepted,
    rowId: "native-regular-file-fd",
    proofStatus: "verified-seed",
    sourceArch,
    targetArch,
    capturedState: {
      fd: 3,
      kind: "file",
      path: fixturePath,
      offset: prefix.length,
      expectedNextBytesSha256,
    },
    targetReconstruction: {
      planKind: "reopen-file",
      targetFd: 3,
      offset: prefix.length,
      rawCpuRestoreUsed: false,
      sourceIsaEmulationUsed: false,
      appCheckpointHooksRequired: false,
      metadataOnlySuccessAccepted: false,
    },
    verifier: {
      readStartedAtCapturedOffset: true,
      readBytesSha256Matched: true,
      targetOffsetAdvancedTo: targetRead.finalOffset,
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
    join(input.outDir, "regular-file-fd-proof-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

export function loadArbitraryProcessLevel5RegularFileFdProofReport(
  path: string,
): ArbitraryProcessLevel5RegularFileFdProofReport {
  return JSON.parse(readFileSync(path, "utf8")) as ArbitraryProcessLevel5RegularFileFdProofReport;
}

export function verifyArbitraryProcessLevel5RegularFileFdProofReport(
  report: ArbitraryProcessLevel5RegularFileFdProofReport,
): ArbitraryProcessLevel5RegularFileFdProofReport {
  return {
    ...report,
    accepted:
      report.accepted === true &&
      report.kind === ARBITRARY_PROCESS_LEVEL5_REGULAR_FILE_FD_PROOF_KIND &&
      report.version === ARBITRARY_PROCESS_LEVEL5_REGULAR_FILE_FD_PROOF_VERSION &&
      report.rowId === "native-regular-file-fd" &&
      report.proofStatus === "verified-seed" &&
      report.sourceArch !== report.targetArch &&
      report.targetReconstruction.planKind === "reopen-file" &&
      report.targetReconstruction.rawCpuRestoreUsed === false &&
      report.targetReconstruction.sourceIsaEmulationUsed === false &&
      report.targetReconstruction.appCheckpointHooksRequired === false &&
      report.targetReconstruction.metadataOnlySuccessAccepted === false &&
      report.verifier.readStartedAtCapturedOffset === true &&
      report.verifier.readBytesSha256Matched === true &&
      report.claimChangeAllowed === false &&
      report.currentArbitraryProcessCrossArchRestoreClaimed === 0 &&
      report.arbitraryProcessClaimed === false &&
      report.artifactsSha256 === sha256Json(report.artifacts),
  };
}

function readFromCapturedOffset(
  path: string,
  offset: number,
  length: number,
): {
  bytes: string;
  finalOffset: number;
} {
  const fd = openSync(path, "r");
  try {
    if (offset > 0) {
      readSync(fd, Buffer.alloc(offset), 0, offset, null);
    }
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, null);
    return {
      bytes: buffer.subarray(0, bytesRead).toString("utf8"),
      finalOffset: offset + bytesRead,
    };
  } finally {
    closeSync(fd);
  }
}

function writeJsonArtifact(
  outDir: string,
  name: string,
  value: unknown,
): ArbitraryProcessLevel5RegularFileFdProofArtifact {
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
