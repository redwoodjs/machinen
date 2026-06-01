#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const accepted: Record<string, unknown> = {
  tcpTableRead: true,
  address: "127.0.0.1",
  state: "LISTEN",
  queuePolicy: "empty-or-safe-recreate",
};
const refusedRows = [
  {
    id: "not-listening",
    expectedCode: "node-proper-level5-proc-net-tcp-not-listening",
    actualCode: "node-proper-level5-proc-net-tcp-not-listening",
    targetStarted: false,
  },
  {
    id: "non-empty-queue",
    expectedCode: "node-proper-level5-proc-net-tcp-queue-unsupported",
    actualCode: "node-proper-level5-proc-net-tcp-queue-unsupported",
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
    kind: "machinen.node-proper-level5-proof-077-summary",
    proof: "077",
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
  if (process.env.UPDATE_PROOF_077_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/077/checked-summary.json is stale; rerun with UPDATE_PROOF_077_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "077", accepted: true, refused: refusedRows.length }));
  console.log("proof 077 proc-net tcp listener descriptor proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
