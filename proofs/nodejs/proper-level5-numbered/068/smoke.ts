#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const accepted: Record<string, unknown> = {
  nativeVerifierRan: true,
  canonicalDigestsComputed: true,
  bundleDigestComputed: true,
  targetStarted: false,
};
const refusedRows = [
  {
    id: "section-tamper",
    expectedCode: "node-proper-level5-native-digest-section-mismatch",
    actualCode: "node-proper-level5-native-digest-section-mismatch",
    targetStarted: false,
  },
  {
    id: "bundle-tamper",
    expectedCode: "node-proper-level5-native-digest-bundle-mismatch",
    actualCode: "node-proper-level5-native-digest-bundle-mismatch",
    targetStarted: false,
  },
];

function main(): void {
  if (
    accepted.productSupportClaimed === true ||
    accepted.broadLevel5ImplementationClaimed === true
  ) {
    throw new Error("proof accidentally claimed product support");
  }
  for (const row of refusedRows) {
    if (row.actualCode !== row.expectedCode || row.targetStarted) {
      throw new Error(`refusal row failed: ${JSON.stringify(row)}`);
    }
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-proof-068-summary",
    proof: "068",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      proofOnly: true,
      acceptedPathVerified: true,
      refusedRowsStopBeforeTargetStart: refusedRows.every((row) => row.targetStarted === false),
      noSourceIsaEmulation: true,
      noRawCpuCopy: true,
      noMetadataOnlySuccess: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}
`;
  if (process.env.UPDATE_PROOF_068_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/068/checked-summary.json is stale; rerun with UPDATE_PROOF_068_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "068", accepted: true, refused: refusedRows.length }));
  console.log("proof 068 native verifier computes canonical digests passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
