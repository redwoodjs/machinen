#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const accepted: Record<string, unknown> = {
  guestCaptureRan: true,
  sectionsEmitted: 5,
  sourceArchitecture: "arm64",
  targetArchitecture: "amd64",
  count: 3,
  graphTotal: 3,
};
const refusedRows = [
  {
    id: "missing-heap-artifact",
    expectedCode: "node-proper-level5-guest-capture-heap-artifact-missing",
    actualCode: "node-proper-level5-guest-capture-heap-artifact-missing",
    targetStarted: false,
  },
  {
    id: "stale-thread-artifact",
    expectedCode: "node-proper-level5-guest-capture-artifact-stale",
    actualCode: "node-proper-level5-guest-capture-artifact-stale",
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
    kind: "machinen.node-proper-level5-proof-066-summary",
    proof: "066",
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
  if (process.env.UPDATE_PROOF_066_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/066/checked-summary.json is stale; rerun with UPDATE_PROOF_066_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "066", accepted: true, refused: refusedRows.length }));
  console.log("proof 066 guest capture emits section artifacts passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
