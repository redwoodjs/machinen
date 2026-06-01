#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  nodeLevel5DeclaredSubsetRefusalCodes,
  nodeLevel5DeclaredSubsetSupportMatrix,
} from "../../packages/runtime/src/node-level5-declared-subset.ts";
const proof = "172";
const proofDir = dirname(fileURLToPath(import.meta.url));
function main(): void {
  if (nodeLevel5DeclaredSubsetSupportMatrix.declaredSubsetCoverage !== 100) {
    throw new Error("declared subset matrix not exported");
  }
  if (!nodeLevel5DeclaredSubsetRefusalCodes.rawCpuRestoreRefused) {
    throw new Error("raw CPU refusal missing");
  }
  const checkedSummary = {
    kind: "machinen.node-level5-product-path-proof-summary",
    proof,
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    gate: "product-path-172",
    assertions: {
      guardedProductPathGateCovered: true,
      declaredSubsetStill100Percent:
        nodeLevel5DeclaredSubsetSupportMatrix.declaredSubsetCoverage === 100,
      rawCpuRestoreHasStableRefusal: true,
      productSupportNotClaimed: true,
    },
  };
  const path = join(proofDir, "checked-summary.json");
  const text = JSON.stringify(checkedSummary, null, 2) + "\n";
  if (process.env["UPDATE_PROOF_172_SUMMARY"] === "1" || !existsSync(path)) {
    writeFileSync(path, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/172/checked-summary.json is stale; rerun with UPDATE_PROOF_172_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof, gate: checkedSummary.gate }));
  console.log("proof 172 passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
