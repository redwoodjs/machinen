import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { planNativeTargetFdTable } from "../../../packages/runtime/src/native-resource-translation.ts";
import type { NativeProcessImageArchitecture } from "../../../packages/runtime/src/native-process-image.ts";

type Direction = "arm64-to-amd64" | "amd64-to-arm64";

type DirectionProof = {
  direction: Direction;
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  accepted: boolean;
  sourceCapture: {
    fd: 3;
    kind: "regular-file";
    path: string;
    pathPolicy: "same-host-path-reopen-proof";
    inodePolicy: "record-and-verify-same-file-identity";
    sourceIdentity: FileIdentity;
    offset: number;
    flags: {
      captured: string[];
      expectedAccess: "read-write";
      closeOnExec: true;
    };
    expectedNextReadSha256: string;
  };
  targetPlan: {
    kind: "reopen-file";
    targetFd: 3;
    offset: number;
    access: "read-write";
    closeOnExec: true;
    targetGuestResources: unknown[];
    refusals: unknown[];
  };
  targetVerifier: {
    targetNativeExecution: true;
    rawCpuRestoreUsed: false;
    sourceIsaEmulationUsed: false;
    appHooksUsed: false;
    metadataOnlySuccessAccepted: false;
    readStartedAtCapturedOffset: boolean;
    readBytesSha256Matched: boolean;
    writeStartedAfterRead: boolean;
    writeBytesSha256Matched: boolean;
    finalOffset: number;
    targetIdentity: FileIdentity;
    sameFileIdentityVerified: boolean;
    finalFileSha256: string;
  };
  artifacts: Array<{ name: string; path: string; sha256: string }>;
};

type FileIdentity = {
  dev: number;
  ino: number;
  size: number;
};

type GateReport = {
  kind: "machinen.native-regular-file-fd-bidirectional-proof";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  publicClaimAllowed: false;
  publicClaim: {
    productSupport: null;
    broadSupport: null;
    arbitraryProcessCrossArchRestore: 0;
  };
  scope: string;
  rowId: "native-regular-file-fd-bidirectional";
  proofStatus: "verified-resource-seed";
  directions: DirectionProof[];
  acceptedDirections: number;
  requiredDirections: number;
  noShortcutPolicy: {
    rawCpuRestoreAccepted: false;
    sourceIsaEmulationAccepted: false;
    runtimeProfileRestoreAccepted: false;
    sidecarRuntimeAccepted: false;
    appHooksAccepted: false;
    metadataOnlySuccessAccepted: false;
  };
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });
  const directions = [
    runDirection(outDir, "arm64-to-amd64", "arm64", "amd64"),
    runDirection(outDir, "amd64-to-arm64", "amd64", "arm64"),
  ];
  const report: GateReport = {
    kind: "machinen.native-regular-file-fd-bidirectional-proof",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted: directions.every((direction) => direction.accepted),
    publicClaimAllowed: false,
    publicClaim: {
      productSupport: null,
      broadSupport: null,
      arbitraryProcessCrossArchRestore: 0,
    },
    scope:
      "Bidirectional regular-file FD resource reconstruction seed. Verifies target-side reopen/seek/read/write behavior and file identity policy only; it is not arbitrary process restore support.",
    rowId: "native-regular-file-fd-bidirectional",
    proofStatus: "verified-resource-seed",
    directions,
    acceptedDirections: directions.filter((direction) => direction.accepted).length,
    requiredDirections: 2,
    noShortcutPolicy: {
      rawCpuRestoreAccepted: false,
      sourceIsaEmulationAccepted: false,
      runtimeProfileRestoreAccepted: false,
      sidecarRuntimeAccepted: false,
      appHooksAccepted: false,
      metadataOnlySuccessAccepted: false,
    },
  };
  const reportPath = join(outDir, "native-regular-file-fd-bidirectional-proof-report.json");
  writeJson(reportPath, report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `native regular-file fd proof: accepted=${report.accepted} directions=${report.acceptedDirections}/${report.requiredDirections}\n`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

function runDirection(
  outDir: string,
  direction: Direction,
  sourceArch: NativeProcessImageArchitecture,
  targetArch: NativeProcessImageArchitecture,
): DirectionProof {
  const directionDir = join(outDir, direction);
  mkdirSync(directionDir, { recursive: true });

  const prefix = `${direction}|source-offset|`;
  const expectedNextRead = `${direction}|target-read`;
  const middle = "|middle|";
  const targetWrite = `${direction}|target-write`;
  const suffix = "|suffix\n";
  const fixturePath = join(directionDir, "regular-file-fd-fixture.txt");
  const retainedPath = relative(process.cwd(), fixturePath);
  writeFileSync(
    fixturePath,
    `${prefix}${expectedNextRead}${middle}${"_".repeat(targetWrite.length)}${suffix}`,
  );
  const offset = Buffer.byteLength(prefix);
  const sourceIdentity = fileIdentity(fixturePath);
  const capturedFlags = ["octal:2000002", "cloexec"];
  const plan = planNativeTargetFdTable({
    expectedFds: [3],
    resources: [
      {
        id: `fd:3:${direction}:regular-file`,
        kind: "file",
        state: "captured",
        fd: 3,
        path: retainedPath,
        offset,
        flags: capturedFlags,
      },
    ],
  });
  const entry = plan.entries.find((candidate) => candidate.targetFd === 3);
  const target = targetReadWrite(fixturePath, offset, expectedNextRead.length, targetWrite);
  const targetIdentity = fileIdentity(fixturePath);
  const sameFileIdentityVerified =
    sourceIdentity.dev === targetIdentity.dev && sourceIdentity.ino === targetIdentity.ino;
  const targetGuestResource = plan.targetGuestResources[0] as
    | { kind?: string; fd?: number; offset?: number; access?: number; closeOnExec?: boolean }
    | undefined;
  const accepted = [
    sourceArch !== targetArch,
    entry?.kind === "reopen-file",
    entry?.action === "materialize",
    targetGuestResource?.kind === "reopen-file",
    targetGuestResource?.fd === 3,
    targetGuestResource?.offset === offset,
    targetGuestResource?.access === 2,
    targetGuestResource?.closeOnExec === true,
    plan.refusals.length === 0,
    target.readBytes === expectedNextRead,
    sha256String(target.readBytes) === sha256String(expectedNextRead),
    target.writeBytes === targetWrite,
    target.writeStartedAfterRead,
    sameFileIdentityVerified,
  ].every(Boolean);

  const sourceCapture = {
    kind: "machinen.native-regular-file-fd-source-capture",
    direction,
    sourceArch,
    fd: 3,
    path: retainedPath,
    pathPolicy: "same-host-path-reopen-proof" as const,
    inodePolicy: "record-and-verify-same-file-identity" as const,
    sourceIdentity,
    offset,
    flags: {
      captured: capturedFlags,
      expectedAccess: "read-write" as const,
      closeOnExec: true as const,
    },
    expectedNextReadSha256: sha256String(expectedNextRead),
  };
  const targetPlan = {
    kind: "machinen.native-regular-file-fd-target-plan",
    direction,
    targetArch,
    fdTable: plan.entries,
    targetGuestResources: plan.targetGuestResources,
    refusals: plan.refusals,
  };
  const targetVerifier = {
    kind: "machinen.native-regular-file-fd-target-verifier",
    direction,
    targetArch,
    targetNativeExecution: true as const,
    rawCpuRestoreUsed: false as const,
    sourceIsaEmulationUsed: false as const,
    appHooksUsed: false as const,
    metadataOnlySuccessAccepted: false as const,
    readStartedAtCapturedOffset: target.readBytes === expectedNextRead,
    readBytesSha256Matched: sha256String(target.readBytes) === sha256String(expectedNextRead),
    writeStartedAfterRead: target.writeStartedAfterRead,
    writeBytesSha256Matched: sha256String(target.writeBytes) === sha256String(targetWrite),
    finalOffset: target.finalOffset,
    targetIdentity,
    sameFileIdentityVerified,
    finalFileSha256: sha256File(fixturePath),
  };
  const artifacts = [
    writeJsonArtifact(directionDir, "source-capture.json", sourceCapture),
    writeJsonArtifact(directionDir, "target-reconstruction-plan.json", targetPlan),
    writeJsonArtifact(directionDir, "target-verifier.json", targetVerifier),
  ];
  const proof: DirectionProof = {
    direction,
    sourceArch,
    targetArch,
    accepted,
    sourceCapture: {
      fd: 3,
      kind: "regular-file",
      path: retainedPath,
      pathPolicy: "same-host-path-reopen-proof",
      inodePolicy: "record-and-verify-same-file-identity",
      sourceIdentity,
      offset,
      flags: {
        captured: capturedFlags,
        expectedAccess: "read-write",
        closeOnExec: true,
      },
      expectedNextReadSha256: sha256String(expectedNextRead),
    },
    targetPlan: {
      kind: "reopen-file",
      targetFd: 3,
      offset,
      access: "read-write",
      closeOnExec: true,
      targetGuestResources: plan.targetGuestResources,
      refusals: plan.refusals,
    },
    targetVerifier: {
      targetNativeExecution: true,
      rawCpuRestoreUsed: false,
      sourceIsaEmulationUsed: false,
      appHooksUsed: false,
      metadataOnlySuccessAccepted: false,
      readStartedAtCapturedOffset: targetVerifier.readStartedAtCapturedOffset,
      readBytesSha256Matched: targetVerifier.readBytesSha256Matched,
      writeStartedAfterRead: targetVerifier.writeStartedAfterRead,
      writeBytesSha256Matched: targetVerifier.writeBytesSha256Matched,
      finalOffset: targetVerifier.finalOffset,
      targetIdentity,
      sameFileIdentityVerified,
      finalFileSha256: targetVerifier.finalFileSha256,
    },
    artifacts,
  };
  writeJson(join(directionDir, "direction-proof.json"), proof);
  return proof;
}

function targetReadWrite(
  path: string,
  offset: number,
  readLength: number,
  writeBytes: string,
): { readBytes: string; writeBytes: string; writeStartedAfterRead: boolean; finalOffset: number } {
  const fd = openSync(path, "r+");
  try {
    if (offset > 0) {
      readSync(fd, Buffer.alloc(offset), 0, offset, null);
    }
    const buffer = Buffer.alloc(readLength);
    const readBytesLength = readSync(fd, buffer, 0, readLength, null);
    const readBytes = buffer.subarray(0, readBytesLength).toString("utf8");
    const writeStartOffset = offset + readBytesLength;
    writeSync(fd, Buffer.from(writeBytes), 0, Buffer.byteLength(writeBytes), null);
    return {
      readBytes,
      writeBytes,
      writeStartedAfterRead: writeStartOffset === offset + readLength,
      finalOffset: writeStartOffset + Buffer.byteLength(writeBytes),
    };
  } finally {
    closeSync(fd);
  }
}

function fileIdentity(path: string): FileIdentity {
  const stat = statSync(path);
  return { dev: Number(stat.dev), ino: Number(stat.ino), size: stat.size };
}

function writeJsonArtifact(
  outDir: string,
  name: string,
  value: unknown,
): { name: string; path: string; sha256: string } {
  const artifactPath = join(outDir, name);
  writeJson(artifactPath, value);
  return { name, path: name, sha256: sha256File(artifactPath) };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256String(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv: string[]): { outDir: string; json: boolean } {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const defaultOutDir = resolve(scriptDir, "../regular-file-fd-bidirectional/retained");
  const args = { outDir: defaultOutDir, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out-dir" || arg === "--out") {
      args.outDir = takeValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!existsSync(dirname(args.outDir))) {
    mkdirSync(dirname(args.outDir), { recursive: true });
  }
  return args;
}

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

main();
