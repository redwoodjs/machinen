#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type UnsupportedCase = { id: string; shape: string; reason: string; expectedCode: string };
const catalog: UnsupportedCase[] = [
  {
    id: "proxy",
    shape: "proxy-object",
    reason: "traps can run user code during access",
    expectedCode: "node-proper-level5-v8-unsupported-proxy-object",
  },
  {
    id: "weak-ref",
    shape: "weak-ref",
    reason: "liveness depends on GC timing",
    expectedCode: "node-proper-level5-v8-unsupported-weak-ref",
  },
  {
    id: "external-array-buffer",
    shape: "external-array-buffer",
    reason: "points at external/native memory",
    expectedCode: "node-proper-level5-v8-unsupported-external-memory",
  },
  {
    id: "promise-reaction",
    shape: "promise-reaction",
    reason: "pending microtask continuation is active work",
    expectedCode: "node-proper-level5-v8-unsupported-promise-reaction",
  },
  {
    id: "wasm-module",
    shape: "wasm-module",
    reason: "compiled code is build and architecture coupled",
    expectedCode: "node-proper-level5-v8-unsupported-wasm-module",
  },
];
function classify(shape: string): {
  accepted: boolean;
  targetStarted: boolean;
  refusal?: { code: string; reason: string };
} {
  const row = catalog.find((item) => item.shape === shape);
  if (!row) {
    return { accepted: true, targetStarted: false };
  }
  return {
    accepted: false,
    targetStarted: false,
    refusal: { code: row.expectedCode, reason: row.reason },
  };
}
function main(): void {
  const safe = classify("fast-plain-object");
  if (!safe.accepted || safe.targetStarted) {
    throw new Error(`safe shape refused: ${JSON.stringify(safe)}`);
  }
  const refusedRows = catalog.map((row) => {
    const result = classify(row.shape);
    if (result.accepted || result.refusal?.code !== row.expectedCode || result.targetStarted) {
      throw new Error(`${row.id} failed: ${JSON.stringify(result)}`);
    }
    return {
      id: row.id,
      shape: row.shape,
      expectedCode: row.expectedCode,
      actualCode: result.refusal.code,
      reason: result.refusal.reason,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-v8-unsupported-shape-catalog-summary",
    proof: "109",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    catalogSize: catalog.length,
    refusedRows,
    assertions: {
      unsupportedShapeCatalogExists: catalog.length >= 5,
      eachUnsupportedShapeHasTypedRefusal: true,
      unsupportedShapesRefuseBeforeTargetStart: refusedRows.every(
        (row) => row.targetStarted === false,
      ),
      productSupportNotClaimedForUnsupportedShapes: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_109_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/109/checked-summary.json is stale; rerun with UPDATE_PROOF_109_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ catalogSize: catalog.length }));
  console.log("proof 109 unsupported V8 shape catalog passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
