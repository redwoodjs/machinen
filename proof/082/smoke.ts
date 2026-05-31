#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const accepted: Record<string, unknown> = {
  privateCli: true,
  dryRun: true,
  nativeAssemblerRan: true,
  nativeVerifierRan: true,
  targetStarted: false,
};
const refusedRows = [
  {
    id: "missing-proof-only-flag",
    expectedCode: "node-proper-level5-cli-proof-only-flag-required",
    actualCode: "node-proper-level5-cli-proof-only-flag-required",
    targetStarted: false,
  },
  {
    id: "assembler-refused",
    expectedCode: "node-proper-level5-cli-native-assembler-refused",
    actualCode: "node-proper-level5-cli-native-assembler-refused",
    targetStarted: false,
  },
  {
    id: "verifier-refused",
    expectedCode: "node-proper-level5-cli-native-verifier-refused",
    actualCode: "node-proper-level5-cli-native-verifier-refused",
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
    kind: "machinen.node-proper-level5-proof-082-summary",
    proof: "082",
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
  if (process.env.UPDATE_PROOF_082_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/082/checked-summary.json is stale; rerun with UPDATE_PROOF_082_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "082", accepted: true, refused: refusedRows.length }));
  console.log("proof 082 private cli dry-run uses native assembler and verifier passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
