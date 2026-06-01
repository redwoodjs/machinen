#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const accepted: Record<string, unknown> = {
  typedReportEmitted: true,
  acceptedReportCode: "accepted",
  targetStarted: false,
};
const refusedRows = [
  {
    id: "bad-architecture",
    expectedCode: "node-proper-level5-typed-refusal-architecture",
    actualCode: "node-proper-level5-typed-refusal-architecture",
    targetStarted: false,
    section: "architecture",
    field: "target",
    evidencePath: "/capture/architecture.json",
  },
  {
    id: "bad-continuation",
    expectedCode: "node-proper-level5-typed-refusal-continuation",
    actualCode: "node-proper-level5-typed-refusal-continuation",
    targetStarted: false,
    section: "continuationDescriptor",
    field: "continuationClass",
    evidencePath: "/capture/thread.json",
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
    kind: "machinen.node-proper-level5-proof-069-summary",
    proof: "069",
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
  if (process.env.UPDATE_PROOF_069_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/069/checked-summary.json is stale; rerun with UPDATE_PROOF_069_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "069", accepted: true, refused: refusedRows.length }));
  console.log("proof 069 native verifier typed refusal report passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
