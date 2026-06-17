import { createHash } from "node:crypto";

/**
 * Non-product proof harness for #970. It models dirty-range rootdisk
 * snapshots against an already-verified base image and refuses to
 * reconstruct unless every byte-level invariant checks out.
 */
export interface DirtyRangeProofBundle {
  version: 1;
  baseSizeBytes: number;
  baseSha256: string;
  targetSha256: string;
  chunkSize: number;
  ranges: DirtyRangeProof[];
}

interface DirtyRangeProof {
  offset: number;
  length: number;
  sha256: string;
  dataBase64: string;
}

class DirtyRangeProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirtyRangeProofError";
  }
}

export function buildDirtyRangeProof(
  base: Buffer,
  target: Buffer,
  chunkSize = 4096,
): DirtyRangeProofBundle {
  if (base.length !== target.length) {
    throw new DirtyRangeProofError("dirty range proof requires equal-size images");
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new DirtyRangeProofError("dirty range proof chunk size must be positive");
  }
  const ranges: DirtyRangeProof[] = [];
  for (let offset = 0; offset < target.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, target.length);
    const baseChunk = base.subarray(offset, end);
    const targetChunk = target.subarray(offset, end);
    if (baseChunk.equals(targetChunk)) {
      continue;
    }
    ranges.push({
      offset,
      length: targetChunk.length,
      sha256: sha256(targetChunk),
      dataBase64: targetChunk.toString("base64"),
    });
  }
  return {
    version: 1,
    baseSizeBytes: base.length,
    baseSha256: sha256(base),
    targetSha256: sha256(target),
    chunkSize,
    ranges,
  };
}

export function applyDirtyRangeProof(base: Buffer, proof: DirtyRangeProofBundle): Buffer {
  validateProofHeader(base, proof);
  const target = Buffer.from(base);
  let nextOffset = 0;
  for (const range of proof.ranges) {
    const data = validateRange(range, proof.baseSizeBytes, nextOffset);
    data.copy(target, range.offset);
    nextOffset = range.offset + range.length;
  }
  const actualTargetSha256 = sha256(target);
  if (actualTargetSha256 !== proof.targetSha256) {
    throw new DirtyRangeProofError(
      `dirty range target sha256 mismatch: expected ${proof.targetSha256}, got ${actualTargetSha256}`,
    );
  }
  return target;
}

function validateProofHeader(base: Buffer, proof: DirtyRangeProofBundle): void {
  if (proof.version !== 1) {
    throw new DirtyRangeProofError(`unsupported dirty range proof version ${proof.version}`);
  }
  if (proof.baseSizeBytes !== base.length) {
    throw new DirtyRangeProofError("dirty range base size mismatch");
  }
  if (proof.baseSha256 !== sha256(base)) {
    throw new DirtyRangeProofError("dirty range base sha256 mismatch");
  }
  if (!Number.isInteger(proof.chunkSize) || proof.chunkSize <= 0) {
    throw new DirtyRangeProofError("dirty range proof chunk size must be positive");
  }
}

function validateRange(range: DirtyRangeProof, imageSize: number, minOffset: number): Buffer {
  if (!Number.isInteger(range.offset) || !Number.isInteger(range.length) || range.length <= 0) {
    throw new DirtyRangeProofError("dirty range has invalid offset or length");
  }
  if (range.offset < minOffset) {
    throw new DirtyRangeProofError("dirty ranges must be sorted and non-overlapping");
  }
  if (range.offset + range.length > imageSize) {
    throw new DirtyRangeProofError("dirty range exceeds image bounds");
  }
  const data = Buffer.from(range.dataBase64, "base64");
  if (data.length !== range.length) {
    throw new DirtyRangeProofError("dirty range data length mismatch");
  }
  const actualSha256 = sha256(data);
  if (actualSha256 !== range.sha256) {
    throw new DirtyRangeProofError(
      `dirty range data sha256 mismatch: expected ${range.sha256}, got ${actualSha256}`,
    );
  }
  return data;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
