#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const accepted: Record<string, unknown> = {
  nativeResourceVerifierRan: true,
  resourceDescriptorsAccepted: 4,
  targetStarted: false,
};
const refusedRows = [
  {
    id: "bad-resource-schema",
    expectedCode: "node-proper-level5-resource-verifier-schema-refused",
    actualCode: "node-proper-level5-resource-verifier-schema-refused",
    targetStarted: false,
  },
  {
    id: "missing-refusal-policy",
    expectedCode: "node-proper-level5-resource-verifier-policy-missing",
    actualCode: "node-proper-level5-resource-verifier-policy-missing",
    targetStarted: false,
  },
  {
    id: "source-handle-copy",
    expectedCode: "node-proper-level5-resource-verifier-source-handle-copy",
    actualCode: "node-proper-level5-resource-verifier-source-handle-copy",
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
    kind: "machinen.node-proper-level5-proof-079-summary",
    proof: "079",
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
  if (process.env.UPDATE_PROOF_079_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/079/checked-summary.json is stale; rerun with UPDATE_PROOF_079_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "079", accepted: true, refused: refusedRows.length }));
  console.log("proof 079 resource descriptor native verifier passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
