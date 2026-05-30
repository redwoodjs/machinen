import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createNodeLevel5ProductSnapshot,
  isNodeLevel5ProductSnapshotBundle,
  restoreNodeLevel5ProductSnapshot,
} from "../node-level5-product-snapshot.ts";

describe("Node Level 5 product snapshot facade", () => {
  it("creates and restores a product-shaped Node snapshot without experimental flags", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-product-snapshot-"));
    try {
      const summary = createNodeLevel5ProductSnapshot({
        outDir: dir,
        familyId: "express-fastify-http-app",
        direction: "arm64-to-amd64",
      });
      expect(summary.accepted).toBe(true);
      expect(summary.manifest).toMatchObject({
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
        translatedContinuationRequired: true,
        rawCpuRestoreSupported: false,
      });
      expect(isNodeLevel5ProductSnapshotBundle(dir)).toBe(true);

      expect(restoreNodeLevel5ProductSnapshot({ snapshotDir: dir })).toMatchObject({
        accepted: true,
        familyId: "express-fastify-http-app",
        direction: "arm64-to-amd64",
        artifactHashesVerified: true,
        retentionComplete: true,
        rawCpuRestoreUsed: false,
        sourceIsaEmulationUsed: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
