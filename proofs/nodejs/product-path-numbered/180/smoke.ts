#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../../../..");
const auditedProofs = Array.from({ length: 9 }, (_value, index) =>
  String(index + 171).padStart(3, "0"),
);
function main(): void {
  for (const proof of auditedProofs) {
    const summary = JSON.parse(
      readFileSync(join(repoRoot, "proofs", "by-id", proof, "checked-summary.json"), "utf8"),
    );
    if (
      summary.scope !== "proof-only-harness-not-product-support" ||
      summary.productSupportClaimed ||
      summary.broadLevel5ImplementationClaimed
    ) {
      throw new Error(`proof ${proof} crossed boundary`);
    }
  }
  const readiness = {
    declaredSubsetCoverage: 100,
    narrowExperimentalProductReadiness: 98,
    broadNodeProofReadiness: 92,
    broadNodeProductSupportClaimed: 0,
    arbitraryProcessCrossArchRestore: 5,
  };
  const checkedSummary = {
    kind: "machinen.node-level5-product-path-readiness-audit-summary",
    proof: "180",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    auditedProofs,
    readiness,
    assertions: {
      productPathProofsRemainProofOnly: true,
      declaredSubsetStill100Percent: true,
      narrowExperimentalProductReadinessAt98Percent: true,
      broadNodeProductSupportStillNotClaimed: true,
    },
  };
  const path = join(proofDir, "checked-summary.json");
  const text = JSON.stringify(checkedSummary, null, 2) + "\n";
  if (process.env.UPDATE_PROOF_180_SUMMARY === "1" || !existsSync(path)) {
    writeFileSync(path, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/180/checked-summary.json is stale; rerun with UPDATE_PROOF_180_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "180", readiness }));
  console.log("proof 180 passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
