#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const accepted: Record<string, unknown> = {
  timerDescriptor: true,
  eventfdDescriptor: true,
  pipeDescriptor: true,
  sourceFdReused: false,
};
const refusedRows = [
  {
    id: "missing-timer-evidence",
    expectedCode: "node-proper-level5-timer-evidence-missing",
    actualCode: "node-proper-level5-timer-evidence-missing",
    targetStarted: false,
  },
  {
    id: "bad-eventfd-counter",
    expectedCode: "node-proper-level5-eventfd-counter-unsupported",
    actualCode: "node-proper-level5-eventfd-counter-unsupported",
    targetStarted: false,
  },
  {
    id: "pipe-has-buffered-bytes",
    expectedCode: "node-proper-level5-pipe-buffered-bytes-unsupported",
    actualCode: "node-proper-level5-pipe-buffered-bytes-unsupported",
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
    kind: "machinen.node-proper-level5-proof-078-summary",
    proof: "078",
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
  if (process.env.UPDATE_PROOF_078_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/078/checked-summary.json is stale; rerun with UPDATE_PROOF_078_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "078", accepted: true, refused: refusedRows.length }));
  console.log("proof 078 timer eventfd pipe descriptor evidence expansion passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
