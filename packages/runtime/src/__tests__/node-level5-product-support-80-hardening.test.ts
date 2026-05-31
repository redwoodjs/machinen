import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertNodeLevel5ProductSupport80HardeningComplete,
  createNodeLevel5ProductSupport80ArtifactBundle,
  nodeLevel5ProductSupport80ClaimRegistry,
  verifyNodeLevel5ProductSupport80ArtifactBundle,
} from "../node-level5-product-support-80-hardening.ts";

describe("Node Level 5 80% hardening", () => {
  it("consolidates support claims without broad overclaiming", () => {
    expect(assertNodeLevel5ProductSupport80HardeningComplete()).toBe(true);
    expect(nodeLevel5ProductSupport80ClaimRegistry).toMatchObject({
      nodeProductSupportClaimed: 80,
      broadNodeProductSupportClaimed: 20,
      arbitraryProcessCrossArchRestoreClaimed: 0,
      realVmCrossArchEvidenceRequired: true,
    });
  });

  it("writes and verifies retained artifact bundles", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node80-hardening-"));
    try {
      const bundle = createNodeLevel5ProductSupport80ArtifactBundle({
        outDir: dir,
        familyId: "express-fastify-http-app",
        direction: "arm64-to-amd64",
      });
      const verification = verifyNodeLevel5ProductSupport80ArtifactBundle(bundle);
      expect(verification).toMatchObject({
        accepted: true,
        targetNativeNodeVerified: true,
        behavioralVerifierPassed: true,
        rawCpuRestoreUsed: false,
        sourceIsaEmulationUsed: false,
        metadataOnlySuccessAccepted: false,
        manifestSchemaVerified: true,
        artifactHashesVerified: true,
        retentionComplete: true,
      });
      expect(verification.checkedPaths.length).toBe(9);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses tampered retained artifact content", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node80-hardening-tamper-"));
    try {
      const bundle = createNodeLevel5ProductSupport80ArtifactBundle({
        outDir: dir,
        familyId: "express-fastify-http-app",
        direction: "arm64-to-amd64",
      });
      writeFileSync(bundle.targetLogPath, '{"tampered":true}\n');
      expect(() => verifyNodeLevel5ProductSupport80ArtifactBundle(bundle)).toThrow(/hash mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
