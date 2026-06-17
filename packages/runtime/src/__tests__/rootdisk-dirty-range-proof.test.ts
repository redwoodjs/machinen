import { describe, expect, it } from "vitest";
import {
  applyDirtyRangeProof,
  buildDirtyRangeProof,
  type DirtyRangeProofBundle,
} from "../vm/rootdisk-dirty-range-proof.ts";

function baseImage(): Buffer {
  const buf = Buffer.alloc(16 * 1024);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = i % 251;
  }
  return buf;
}

function cloneProof(proof: DirtyRangeProofBundle): DirtyRangeProofBundle {
  return JSON.parse(JSON.stringify(proof)) as DirtyRangeProofBundle;
}

describe("dirty-range rootdisk proof harness", () => {
  it("reconstructs exact target bytes from changed ranges", () => {
    const base = baseImage();
    const target = Buffer.from(base);
    target.fill(0xaa, 100, 180);
    target.fill(0xbb, 8000, 9000);

    const proof = buildDirtyRangeProof(base, target, 4096);
    const restored = applyDirtyRangeProof(base, proof);

    expect(restored.equals(target)).toBe(true);
    expect(proof.ranges).toHaveLength(3);
  });

  it("round-trips an unchanged image as an empty delta", () => {
    const base = baseImage();
    const proof = buildDirtyRangeProof(base, base, 4096);

    expect(proof.ranges).toHaveLength(0);
    expect(applyDirtyRangeProof(base, proof).equals(base)).toBe(true);
  });

  it("refuses a mismatched base image", () => {
    const base = baseImage();
    const target = Buffer.from(base);
    target[1] = 99;
    const proof = buildDirtyRangeProof(base, target, 4096);
    const wrongBase = Buffer.from(base);
    wrongBase[0] = 42;

    expect(() => applyDirtyRangeProof(wrongBase, proof)).toThrow(/base sha256 mismatch/);
  });

  it("refuses missing dirty ranges instead of reporting metadata-only success", () => {
    const base = baseImage();
    const target = Buffer.from(base);
    target.fill(0xcc, 4096, 4200);
    const proof = cloneProof(buildDirtyRangeProof(base, target, 4096));
    proof.ranges = [];

    expect(() => applyDirtyRangeProof(base, proof)).toThrow(/target sha256 mismatch/);
  });

  it("refuses corrupted dirty range payloads", () => {
    const base = baseImage();
    const target = Buffer.from(base);
    target[8192] = 12;
    const proof = cloneProof(buildDirtyRangeProof(base, target, 4096));
    proof.ranges[0]!.dataBase64 = Buffer.alloc(proof.ranges[0]!.length, 0xff).toString("base64");

    expect(() => applyDirtyRangeProof(base, proof)).toThrow(/data sha256 mismatch/);
  });

  it("refuses overlapping dirty ranges", () => {
    const base = baseImage();
    const target = Buffer.from(base);
    target.fill(0xdd, 4096, 8200);
    const proof = cloneProof(buildDirtyRangeProof(base, target, 4096));
    proof.ranges[1]!.offset = proof.ranges[0]!.offset + 1;

    expect(() => applyDirtyRangeProof(base, proof)).toThrow(/sorted and non-overlapping/);
  });

  it("refuses out-of-bounds dirty ranges", () => {
    const base = baseImage();
    const target = Buffer.from(base);
    target[base.length - 1] = 77;
    const proof = cloneProof(buildDirtyRangeProof(base, target, 4096));
    proof.ranges[0]!.offset = base.length;

    expect(() => applyDirtyRangeProof(base, proof)).toThrow(/exceeds image bounds/);
  });
});
