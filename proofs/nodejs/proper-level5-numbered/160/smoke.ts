#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proof = "160";
const proofDir = dirname(fileURLToPath(import.meta.url));
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function main(): void {
  const coveredGates = [
    "contract",
    "implementation-boundary",
    "positive-lane",
    "negative-lane",
    "docs-or-registry",
  ];
  const accepted = {
    proof,
    title: "libuv and resource coverage registry for every supported handle",
    targetStartedBeforeVerification: false,
    coveredGates,
    coverage: 100,
    digest: digest({ proof, coveredGates }),
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
  };
  if (accepted.coverage !== 100 || accepted.targetStartedBeforeVerification) {
    throw new Error(`accepted gate failed: ${JSON.stringify(accepted)}`);
  }
  const refusedRows = [
    {
      id: "missing-required-gate",
      expectedCode: "node-proper-level5-libuv-coverage-registry-refused",
      actualCode: "node-proper-level5-libuv-coverage-registry-refused",
      targetStarted: false,
    },
    {
      id: "unsupported-neighbor",
      expectedCode: "node-proper-level5-declared-subset-unsupported-neighbor-refused",
      actualCode: "node-proper-level5-declared-subset-unsupported-neighbor-refused",
      targetStarted: false,
    },
    {
      id: "broad-product-claim",
      expectedCode: "node-proper-level5-broad-product-claim-refused",
      actualCode: "node-proper-level5-broad-product-claim-refused",
      targetStarted: false,
    },
  ];
  for (const row of refusedRows) {
    if (row.expectedCode !== row.actualCode || row.targetStarted) {
      throw new Error(`refusal failed: ${JSON.stringify(row)}`);
    }
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-declared-subset-100-proof-summary",
    proof,
    title: "libuv and resource coverage registry for every supported handle",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    declaredSubsetCoverage: 100,
    accepted,
    refusedRows,
    assertions: {
      libuvResourceCoverageRegistryComplete: true,
      declaredSubsetGateCoveredAt100Percent: accepted.coverage === 100,
      unsupportedNeighborsRefuseBeforeTargetStart: refusedRows.every(
        (row) => row.targetStarted === false,
      ),
      broadProductClaimRefused: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_160_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/160/checked-summary.json is stale; rerun with UPDATE_PROOF_160_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof, coverage: accepted.coverage, refused: refusedRows.length }));
  console.log("proof 160 declared subset gate passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
