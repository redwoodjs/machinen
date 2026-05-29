import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const CLI = resolve("packages/cli/src/cli.ts");
const PROOF_RUN = resolve(
  "docs/snapshot/checked-summaries/level4-graduation/goal-009-proof-run.json",
);

describe("Node Level 5 default public restore proof", () => {
  it("runs the target-side proof verifier by default while refusing product support", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-default-restore-"));
    try {
      copyFileSync(PROOF_RUN, join(dir, "node-level5-proof-composition.json"));
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", CLI, "restore", dir, "--json"],
        {
          encoding: "utf8",
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({
        kind: "machinen.node-level5-proof-restore-summary",
        productSupport: "not-yet-supported",
        implementationLevel: "not-implemented",
        migrationCompleted: false,
        restoreRoutedThroughPublicVerb: true,
        level5AdapterId: "node-level5-proof-runtime-adapter",
        level5AdapterRegistryRouted: true,
        targetProofVerifierRanByDefault: true,
        refusal: { code: "node-level5-proof-only-not-product" },
        targetProof: {
          status: "passed",
          noSourceIsaEmulation: true,
          noSidecarOutput: true,
          noMetadataOnlySuccess: true,
          targetVerifierObservedActualNodeContinuation: true,
        },
      });
      expect(
        JSON.parse(readFileSync(join(dir, "node-level5-proof-restore-summary.json"), "utf8")),
      ).toMatchObject({
        level5AdapterRegistryRouted: true,
        targetProofVerifierRanByDefault: true,
        targetProof: { targetVerifierObservedActualNodeContinuation: true },
      });
      expect(
        JSON.parse(readFileSync(join(dir, "node-level5-target-proof.json"), "utf8")),
      ).toMatchObject({
        targetOutput: { runtime: "node", targetNativeExecution: true },
        assertions: {
          sourceIsaEmulationUsed: false,
          sidecarOutputUsed: false,
          metadataOnlySuccess: false,
          targetVerifierObservedActualNodeContinuation: true,
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("only exits 0 for proof automation when explicitly allowed", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-default-restore-ok-"));
    try {
      copyFileSync(PROOF_RUN, join(dir, "node-level5-proof-composition.json"));
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", CLI, "restore", dir, "--json", "--allow-proof-only-success"],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({
        productSupport: "not-yet-supported",
        implementationLevel: "not-implemented",
        migrationCompleted: false,
        refusal: { code: "node-level5-proof-only-not-product" },
        targetProof: { status: "passed" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
