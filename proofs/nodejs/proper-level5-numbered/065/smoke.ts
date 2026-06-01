#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../../../..");
const proofs = ["056", "057", "058", "059", "060", "061", "062", "063", "064"];
const forbidden = [
  /product support is complete/i,
  /production-ready Level 5/i,
  /raw cross-architecture CPU restore is supported/i,
  /public restore feature for translated continuation/i,
];
function auditProof(id: string): Record<string, unknown> {
  const readme = readFileSync(join(repoRoot, "proofs", "by-id", id, "README.md"), "utf8");
  const summary = JSON.parse(
    readFileSync(join(repoRoot, "proofs", "by-id", id, "checked-summary.json"), "utf8"),
  ) as Record<string, unknown>;
  const text = readme + JSON.stringify(summary);
  const forbiddenMatches = forbidden
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);
  return {
    proof: id,
    claimStatus: "proof-only",
    productSupportClaimed: summary.productSupportClaimed === true,
    broadLevel5ImplementationClaimed: summary.broadLevel5ImplementationClaimed === true,
    hasBoundaryLanguage: /proof-only|not product support|no product support/i.test(text),
    forbiddenMatches,
    accepted:
      summary.productSupportClaimed !== true &&
      summary.broadLevel5ImplementationClaimed !== true &&
      forbiddenMatches.length === 0,
  };
}
function main(): void {
  const rows = proofs.map(auditProof);
  const failures = rows.filter((row) => row.accepted !== true);
  if (failures.length > 0) {
    throw new Error(`product boundary failures: ${JSON.stringify(failures, null, 2)}`);
  }
  const publicDocs = ["README.md", "docs/README.md", "docs/quickstart.md"]
    .filter((path) => existsSync(join(repoRoot, path)))
    .map((path) => ({ path, text: readFileSync(join(repoRoot, path), "utf8") }));
  const docMatches = publicDocs.flatMap((doc) =>
    forbidden
      .filter((pattern) => pattern.test(doc.text))
      .map((pattern) => ({ path: doc.path, pattern: pattern.source })),
  );
  if (docMatches.length > 0) {
    throw new Error(`public doc claim failures: ${JSON.stringify(docMatches)}`);
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-product-boundary-regression-audit-summary",
    proof: "065",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    auditedProofs: proofs,
    rows,
    publicDocsAudited: publicDocs.map((doc) => doc.path),
    assertions: {
      noNewProofClaimsProductSupport: true,
      noNewProofClaimsBroadLevel5: true,
      publicDocsDoNotAdvertiseTranslatedContinuationSupport: true,
      rawCrossArchCpuRestoreStillNotClaimed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_065_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/065/checked-summary.json is stale; rerun with UPDATE_PROOF_065_SUMMARY=1",
    );
  }
  console.log(
    JSON.stringify({ auditedProofs: proofs.length, publicDocs: publicDocs.length, failures: 0 }),
  );
  console.log("proof 065 product boundary regression audit passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
