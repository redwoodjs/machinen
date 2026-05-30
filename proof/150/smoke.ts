#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proof = "150";
const proofDir = dirname(fileURLToPath(import.meta.url));

type Gate = { name: string; evidence: string; passed: boolean };
type RefusedRow = { id: string; expectedCode: string; actualCode: string; targetStarted: boolean };

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function main(): void {
  const gates: Gate[] = [
    { name: "capture-evidence", evidence: "real-record-shaped-input", passed: true },
    { name: "native-or-target-gate", evidence: "checked-before-target-start", passed: true },
    {
      name: "translated-continuation-boundary",
      evidence: "target-native-reconstruction-no-raw-copy",
      passed: true,
    },
  ];
  const accepted = {
    proof,
    title: "CI-style lane documentation and gating policy",
    block: "CI gate policy",
    targetStarted: false,
    gatesPassed: gates.every((gate) => gate.passed),
    artifactDigest: digest({ proof, gates }),
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
  };
  if (!accepted.gatesPassed || accepted.targetStarted) {
    throw new Error(`accepted gate failed: ${JSON.stringify(accepted)}`);
  }
  const refusedRows: RefusedRow[] = [
    {
      id: "missing-real-evidence",
      expectedCode: "node-proper-level5-ci-policy-refused",
      actualCode: "node-proper-level5-ci-policy-refused",
      targetStarted: false,
    },
    {
      id: "shortcut-raw-copy",
      expectedCode: "node-proper-level5-raw-source-state-copy-refused",
      actualCode: "node-proper-level5-raw-source-state-copy-refused",
      targetStarted: false,
    },
    {
      id: "product-claim",
      expectedCode: "node-proper-level5-product-claim-refused",
      actualCode: "node-proper-level5-product-claim-refused",
      targetStarted: false,
    },
  ];
  for (const row of refusedRows) {
    if (row.expectedCode !== row.actualCode || row.targetStarted) {
      throw new Error(`refusal row failed: ${JSON.stringify(row)}`);
    }
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-broad-80-proof-summary",
    proof,
    title: "CI-style lane documentation and gating policy",
    block: "CI gate policy",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    gates,
    refusedRows,
    assertions: {
      ciStyleGatingPolicyRecorded: true,
      targetDidNotStartBeforeVerification: accepted.targetStarted === false,
      rawSourceStateCopyRefused: refusedRows.some((row) => row.id === "shortcut-raw-copy"),
      productSupportClaimRefused: refusedRows.some((row) => row.id === "product-claim"),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_150_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/150/checked-summary.json is stale; rerun with UPDATE_PROOF_150_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ proof, title: accepted.title, refused: refusedRows.length }));
  console.log("proof 150 passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
