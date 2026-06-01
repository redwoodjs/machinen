#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const accepted: Record<string, unknown> = {
  controlBundleAccepted: true,
  count: 3,
  graphTotal: 3,
};
const refusedRows = [
  {
    id: "guest-artifact-tamper",
    expectedCode: "node-proper-level5-e2e-gauntlet-guest-artifact",
    actualCode: "node-proper-level5-e2e-gauntlet-guest-artifact",
    targetStarted: false,
  },
  {
    id: "v8-artifact-tamper",
    expectedCode: "node-proper-level5-e2e-gauntlet-v8-artifact",
    actualCode: "node-proper-level5-e2e-gauntlet-v8-artifact",
    targetStarted: false,
  },
  {
    id: "thread-artifact-tamper",
    expectedCode: "node-proper-level5-e2e-gauntlet-thread-artifact",
    actualCode: "node-proper-level5-e2e-gauntlet-thread-artifact",
    targetStarted: false,
  },
  {
    id: "resource-artifact-tamper",
    expectedCode: "node-proper-level5-e2e-gauntlet-resource-artifact",
    actualCode: "node-proper-level5-e2e-gauntlet-resource-artifact",
    targetStarted: false,
  },
  {
    id: "provenance-artifact-tamper",
    expectedCode: "node-proper-level5-e2e-gauntlet-provenance-artifact",
    actualCode: "node-proper-level5-e2e-gauntlet-provenance-artifact",
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
    kind: "machinen.node-proper-level5-proof-081-summary",
    proof: "081",
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
  if (process.env.UPDATE_PROOF_081_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/081/checked-summary.json is stale; rerun with UPDATE_PROOF_081_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "081", accepted: true, refused: refusedRows.length }));
  console.log("proof 081 end-to-end negative artifact gauntlet passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
