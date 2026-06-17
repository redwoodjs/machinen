import { existsSync, statSync } from "node:fs";

import { BootError } from "../errors.ts";
import type { PhaseTimer } from "../phase-timer.ts";
import type { SnapshotFileIdentity } from "../vm-handle.ts";
import {
  fileIdentity,
  fileSampleSha256,
  managedRootDiskSyntheticSha256,
  trustedFileIdentity,
} from "./vmstate-metadata.ts";

export function validateIdentity(
  label: string,
  path: string,
  expected: SnapshotFileIdentity,
  phases: PhaseTimer | undefined,
  source: "bundled" | "external",
): void {
  if (!existsSync(path)) {
    throw new BootError("BOOT_SNAPSHOT_NOT_FOUND", `restore: ${label} not found: ${path}`);
  }
  if (source === "bundled" && validateTrustedContentSample(label, path, expected, phases)) {
    return;
  }

  const cached = source === "bundled" ? trustedFileIdentity(path) : undefined;
  phases?.start(cached ? `${label}-identity.cache-hit` : `${label}-identity.sha256`);
  const actual = cached ?? fileIdentity(path);
  phases?.end(cached ? `${label}-identity.cache-hit` : `${label}-identity.sha256`);
  if (actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256) {
    throwIdentityMismatch(label, expected, actual);
  }
}

function validateTrustedContentSample(
  label: string,
  path: string,
  expected: SnapshotFileIdentity,
  phases: PhaseTimer | undefined,
): boolean {
  const sample = expected.trustedContentSample;
  if (sample?.algorithm !== "machinen-rootdisk-sample-v1") {
    return false;
  }
  phases?.start(`${label}-identity.trusted-sample`);
  const sizeBytes = statSync(path).size;
  const sampleSha256 = fileSampleSha256(path);
  const actual = {
    sizeBytes,
    sha256: managedRootDiskSyntheticSha256(sizeBytes, sampleSha256),
  };
  phases?.end(`${label}-identity.trusted-sample`);
  if (actual.sizeBytes !== expected.sizeBytes || sampleSha256 !== sample.sha256) {
    throwIdentityMismatch(label, expected, actual);
  }
  return true;
}

function throwIdentityMismatch(
  label: string,
  expected: SnapshotFileIdentity,
  actual: SnapshotFileIdentity,
): never {
  throw new BootError(
    "BOOT_VMSTATE_UNSUPPORTED",
    `restore: ${label} identity mismatch.\n` +
      `  expected: size=${expected.sizeBytes} sha256=${expected.sha256}\n` +
      `  actual:   size=${actual.sizeBytes} sha256=${actual.sha256}\n` +
      "  vmstate restore requires byte-identical artifacts.",
  );
}
