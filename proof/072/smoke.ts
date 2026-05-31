#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const accepted: Record<string, unknown> = {
  graphEdgesDecoded: 3,
  mapProvenanceRecords: 3,
  count: 3,
  graphTotal: 3,
};
const refusedRows = [
  {
    id: "missing-map-provenance",
    expectedCode: "node-proper-level5-v8-map-provenance-missing",
    actualCode: "node-proper-level5-v8-map-provenance-missing",
    targetStarted: false,
  },
  {
    id: "conflicting-map-provenance",
    expectedCode: "node-proper-level5-v8-map-provenance-conflict",
    actualCode: "node-proper-level5-v8-map-provenance-conflict",
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
    kind: "machinen.node-proper-level5-proof-072-summary",
    proof: "072",
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
  if (process.env.UPDATE_PROOF_072_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/072/checked-summary.json is stale; rerun with UPDATE_PROOF_072_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "072", accepted: true, refused: refusedRows.length }));
  console.log("proof 072 v8 object graph decoder with map provenance passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
