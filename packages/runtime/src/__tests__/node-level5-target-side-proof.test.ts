import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runNodeLevel5TargetSideProof } from "../node-level5-target-side-proof.ts";

describe("Node Level 5 target-side proof fixture", () => {
  it("runs a small target-native Node HTTP app and verifies actual target output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-target-proof-test-"));
    try {
      const outPath = join(dir, "target-proof.json");
      const proof = await runNodeLevel5TargetSideProof({ outPath, token: "target-proof-token" });
      expect(proof).toMatchObject({
        kind: "machinen.node-level5-target-side-continuation-proof",
        productSupport: "not-yet-supported",
        implementationLevel: "not-implemented",
        graduationTargetLevel: "level-5-cross-arch-process-continuation",
        fixture: { kind: "small-node-http-app" },
        capture: { selectedProofState: { continuationToken: "target-proof-token" } },
        restoreHarness: {
          kind: "target-side-node-http-proof-harness",
          targetNativeExecution: true,
        },
        targetOutput: {
          kind: "machinen.node-level5-target-output",
          continuationToken: "target-proof-token",
          runtime: "node",
          targetNativeExecution: true,
        },
        assertions: {
          sourceIsaEmulationUsed: false,
          sidecarOutputUsed: false,
          metadataOnlySuccess: false,
          targetVerifierObservedActualNodeContinuation: true,
        },
        summary: {
          migrationCompleted: false,
          proofOnly: true,
          targetOutputVerified: true,
        },
      });
      expect(JSON.parse(readFileSync(outPath, "utf8"))).toMatchObject({
        assertions: { targetVerifierObservedActualNodeContinuation: true },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
