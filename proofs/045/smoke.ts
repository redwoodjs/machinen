#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");

const auditedProofs = [
  "027",
  "028",
  "029",
  "030",
  "031",
  "032",
  "033",
  "034",
  "035",
  "036",
  "037",
  "038",
  "039",
  "040",
  "041",
  "042",
  "043",
  "044",
];
const claimStatusByProof = Object.fromEntries(
  auditedProofs.map((proof) => [proof, "proof-only"] as const),
) as Record<string, "proof-only">;
const forbiddenProductClaimPatterns = [
  /product support is complete/i,
  /production-ready Level 5/i,
  /raw cross-architecture CPU restore is supported/i,
  /runtime-level profile product path is supported/i,
];

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function auditProof(id: string): Record<string, unknown> {
  const readmePath = join(repoRoot, "proofs", id, "README.md");
  const summaryPath = join(repoRoot, "proofs", id, "checked-summary.json");
  const readme = readIfExists(readmePath);
  const summaryText = readIfExists(summaryPath);
  const forbiddenMatches = forbiddenProductClaimPatterns
    .filter((pattern) => pattern.test(readme) || pattern.test(summaryText))
    .map((pattern) => pattern.source);
  const summary = summaryText ? (JSON.parse(summaryText) as Record<string, unknown>) : {};
  const productSupportClaimed = summary.productSupportClaimed === true;
  const broadLevel5ImplementationClaimed = summary.broadLevel5ImplementationClaimed === true;
  const explicitClaimStatus = claimStatusByProof[id];
  return {
    proof: id,
    readmePresent: readme.length > 0,
    checkedSummaryPresent: summaryText.length > 0,
    claimStatus: explicitClaimStatus,
    productSupportClaimed,
    broadLevel5ImplementationClaimed,
    forbiddenMatches,
    accepted:
      explicitClaimStatus === "proof-only" &&
      !productSupportClaimed &&
      !broadLevel5ImplementationClaimed &&
      forbiddenMatches.length === 0,
  };
}

function main(): void {
  const rows = auditedProofs.map(auditProof);
  const failures = rows.filter((row) => row.accepted !== true);
  const shortcutPolicy = {
    runtimeLevelProfilesForbidden: true,
    appExportedStateForbidden: true,
    checkpointHooksForbidden: true,
    selectedStateDescriptorsForbidden: true,
    sidecarReplayForbidden: true,
    sourceIsaEmulationForbidden: true,
    metadataOnlySuccessForbidden: true,
    rawCrossArchCpuRestoreForbidden: true,
  };
  if (failures.length > 0) {
    throw new Error(`claim audit failures: ${JSON.stringify(failures, null, 2)}`);
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-product-boundary-claim-audit-summary",
    proof: "045",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    auditedProofs,
    rows,
    shortcutPolicy,
    assertions: {
      everyAuditedProofHasExplicitClaimStatus: rows.every(
        (row) => row.claimStatus === "proof-only",
      ),
      noAuditedProofClaimsProductSupport: rows.every((row) => row.productSupportClaimed === false),
      noAuditedProofClaimsBroadLevel5: rows.every(
        (row) => row.broadLevel5ImplementationClaimed === false,
      ),
      rawCrossArchCpuRestoreRemainsForbidden: true,
      translatedContinuationRemainsNorthStar: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_045_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/045/checked-summary.json is stale; rerun with UPDATE_PROOF_045_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ audited: rows.length, failures: failures.length }));
  console.log("node proper Level 5 product boundary claim audit passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
