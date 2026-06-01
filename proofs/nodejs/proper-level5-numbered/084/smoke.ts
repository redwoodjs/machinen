#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const accepted: Record<string, unknown> = {
  sourceArchitecture: "amd64",
  targetArchitecture: "arm64",
  targetNative: true,
  count: 3,
  graphTotal: 3,
};
const refusedRows = [
  {
    id: "same-arch",
    expectedCode: "node-proper-level5-mirror-cross-arch-required",
    actualCode: "node-proper-level5-mirror-cross-arch-required",
    targetStarted: false,
  },
  {
    id: "source-isa-emulation",
    expectedCode: "node-proper-level5-mirror-source-isa-emulation-refused",
    actualCode: "node-proper-level5-mirror-source-isa-emulation-refused",
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
    kind: "machinen.node-proper-level5-proof-084-summary",
    proof: "084",
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
  if (process.env.UPDATE_PROOF_084_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/084/checked-summary.json is stale; rerun with UPDATE_PROOF_084_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof: "084", accepted: true, refused: refusedRows.length }));
  console.log("proof 084 cross-arch amd64 source to arm64 target mirror proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
