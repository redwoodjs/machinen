import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_KIND,
  PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_REPORT,
  createProductPortablePostgresClaimLadderReport,
  loadProductPortablePostgresClaimLadderReport,
  verifyProductPortablePostgresClaimLadderReport,
} from "../product-portable-postgres-claim-ladder.ts";

describe("product portable Postgres claim ladder", () => {
  it("creates a retained 20 / 0 / 0 claim-ready report", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "postgres-claim-ladder-"));

    const report = createProductPortablePostgresClaimLadderReport({ outDir });
    const verified = verifyProductPortablePostgresClaimLadderReport(report);

    expect(verified).toMatchObject({
      kind: PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_KIND,
      accepted: true,
      currentClaim: {
        productSupport: 20,
        broadSupport: 0,
        arbitraryProcessCrossArchRestore: 0,
      },
      claimChangeAllowed: true,
      nextClaim: { productSupport: 40, claimChangeAllowed: false },
      gates: {
        sourceIsaEmulationAllowed: false,
        sourceTextReplayAllowed: false,
        sidecarRuntimeAllowed: false,
        appHooksAllowed: false,
        metadataOnlyContinuationAllowed: false,
      },
    });
    expect(report.directions).toHaveLength(2);
    expect(report.directions.map((direction) => direction.id)).toEqual([
      "arm64-to-amd64",
      "amd64-to-arm64",
    ]);
    expect(report.directions.every((direction) => direction.targetVerifierResult === "passed"));
    expect(report.refusals[0]).toMatchObject({
      expectedRefusalCode: "postgres-active-transaction-unsupported",
      migrationCompleted: false,
    });
    expect(report.proofs.map((proof) => proof.claimImpact.productSupportDelta)).toEqual([
      8, 5, 4, 3,
    ]);
    expect(
      report.proofs.reduce((sum, proof) => sum + proof.claimImpact.productSupportDelta, 0),
    ).toBe(20);
    expect(report.proofs.every((proof) => proof.claimImpact.broadSupportDelta === 0)).toBe(true);
    expect(
      report.proofs.every((proof) => proof.claimImpact.arbitraryProcessCrossArchRestoreDelta === 0),
    ).toBe(true);
    expect(report.artifacts.map((artifact) => artifact.path)).toContain(
      "arm64-to-amd64/source-verifier.txt",
    );
    expect(report.artifacts.map((artifact) => artifact.path)).toContain(
      "amd64-to-arm64/target-verifier.txt",
    );
    expect(existsSync(join(outDir, PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_REPORT))).toBe(true);

    const loaded = loadProductPortablePostgresClaimLadderReport(
      join(outDir, PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_REPORT),
    );
    expect(verifyProductPortablePostgresClaimLadderReport(loaded).accepted).toBe(true);
  });
});
