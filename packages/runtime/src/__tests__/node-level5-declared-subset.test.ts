import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createNodeLevel5DeclaredSubsetCapture,
  isNodeLevel5DeclaredSubsetManifest,
  nodeLevel5DeclaredSubsetRefusalCodes,
  nodeLevel5DeclaredSubsetSupportMatrix,
  restoreNodeLevel5DeclaredSubset,
} from "../index.ts";

describe("Node Level 5 declared subset runtime contract", () => {
  it("exports the exact experimental support matrix without product claims", () => {
    expect(nodeLevel5DeclaredSubsetSupportMatrix).toMatchObject({
      status: "experimental-candidate-not-supported",
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
      declaredSubsetCoverage: 100,
      node: "22.x",
      v8: "12.x pointer-compressed",
    });
    expect(nodeLevel5DeclaredSubsetSupportMatrix.unsupportedStateFamilies).toContain(
      "raw CPU restore",
    );
  });

  it("writes and restores a guarded manifest behind the experimental flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-declared-subset-"));
    try {
      const capture = createNodeLevel5DeclaredSubsetCapture({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        experimental: true,
      });
      expect(capture.accepted).toBe(true);
      expect(capture.manifestPath).toBe(join(dir, "node-level5-declared-subset-manifest.json"));
      const manifest = JSON.parse(readFileSync(capture.manifestPath!, "utf8"));
      expect(isNodeLevel5DeclaredSubsetManifest(manifest)).toBe(true);

      const restore = restoreNodeLevel5DeclaredSubset({
        manifestPath: capture.manifestPath!,
        experimental: true,
      });
      expect(restore).toMatchObject({
        accepted: true,
        targetStarted: false,
        translatedContinuationRequired: true,
        productSupportClaimed: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses missing flags, invalid manifests, raw CPU restore, and product claims", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-declared-subset-refuse-"));
    try {
      expect(
        createNodeLevel5DeclaredSubsetCapture({
          outDir: dir,
          sourceArch: "arm64",
          targetArch: "amd64",
          experimental: false,
        }).refusal?.code,
      ).toBe(nodeLevel5DeclaredSubsetRefusalCodes.experimentalFlagRequired);
      expect(
        createNodeLevel5DeclaredSubsetCapture({
          outDir: dir,
          sourceArch: "arm64",
          targetArch: "amd64",
          experimental: true,
          productSupportClaimed: true,
        }).refusal?.code,
      ).toBe(nodeLevel5DeclaredSubsetRefusalCodes.productClaimRefused);

      const invalid = join(dir, "invalid.json");
      writeFileSync(invalid, JSON.stringify({ kind: "wrong" }));
      expect(
        restoreNodeLevel5DeclaredSubset({ manifestPath: invalid, experimental: true }).refusal
          ?.code,
      ).toBe(nodeLevel5DeclaredSubsetRefusalCodes.manifestInvalid);
      expect(
        restoreNodeLevel5DeclaredSubset({
          manifestPath: invalid,
          experimental: true,
          rawCpuRestore: true,
        }).refusal?.code,
      ).toBe(nodeLevel5DeclaredSubsetRefusalCodes.rawCpuRestoreRefused);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
