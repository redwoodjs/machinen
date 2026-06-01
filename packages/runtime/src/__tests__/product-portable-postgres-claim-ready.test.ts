import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_REPORT,
  createProductPortablePostgresClaimReadyReport,
  loadProductPortablePostgresClaimReadyReport,
  verifyProductPortablePostgresClaimReadyReport,
} from "../product-portable-postgres-claim-ready.ts";

describe("Postgres clean logical 20% claim-ready gate", () => {
  it("unlocks the candidate 40% gate with retained verifier fixtures", () => {
    const outDir = mkdtempSync(join(tmpdir(), "postgres-claim-ready-"));
    createProductPortablePostgresClaimReadyReport({ outDir });
    const report = verifyProductPortablePostgresClaimReadyReport(
      loadProductPortablePostgresClaimReadyReport(
        join(outDir, PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_REPORT),
      ),
    );

    expect(report.accepted).toBe(true);
    expect(report.gate).toBe("postgres-clean-logical-20-claim-ready");
    expect(report.currentClaim).toMatchObject({ productSupport: 20 });
    expect(report.candidateClaim).toMatchObject({ productSupport: 40 });
    expect(report.claimChangeAllowed).toBe(true);
    expect(report.publicClaimRaised).toBe(false);
    expect(report.rows).toHaveLength(18);
    expect(new Set(report.rows.map((row) => row.kind))).toEqual(
      new Set(["schema-shape", "postgres-version", "workload-mix"]),
    );
    expect(report.gates.every((gate) => gate.passed)).toBe(true);
    expect(report.shortcuts.sourceIsaEmulationUsed).toBe(false);
    expect(report.shortcuts.metadataOnlySuccessAccepted).toBe(false);
    expect(existsSync(join(outDir, "fixtures"))).toBe(true);
  });
});
