#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");
const requiredProofs = ["096", "097", "098", "099", "100", "101", "102", "103", "104"];

type Summary = {
  proof: string;
  scope: string;
  productSupportClaimed: boolean;
  broadLevel5ImplementationClaimed: boolean;
  assertions: Record<string, boolean>;
};
type Matrix = {
  status: string;
  productSupportClaimed: boolean;
  broadLevel5ImplementationClaimed: boolean;
  readiness: Record<string, number>;
  requiredBeforeProductClaim: string[];
};
function main(): void {
  const summaries = requiredProofs.map((proof) => {
    const path = join(repoRoot, "proofs", proof, "checked-summary.json");
    if (!existsSync(path)) {
      throw new Error(`missing checked summary for proof ${proof}`);
    }
    return JSON.parse(readFileSync(path, "utf8")) as Summary;
  });
  for (const summary of summaries) {
    if (
      summary.scope !== "proof-only-harness-not-product-support" ||
      summary.productSupportClaimed ||
      summary.broadLevel5ImplementationClaimed
    ) {
      throw new Error(
        `proof ${summary.proof} crossed product boundary: ${JSON.stringify(summary)}`,
      );
    }
    const failed = Object.entries(summary.assertions).filter(([, value]) => value !== true);
    if (failed.length > 0) {
      throw new Error(`proof ${summary.proof} has failed assertions: ${JSON.stringify(failed)}`);
    }
  }
  const matrix = JSON.parse(readFileSync(join(proofDir, "support-matrix.json"), "utf8")) as Matrix;
  if (
    matrix.status !== "candidate-not-supported" ||
    matrix.productSupportClaimed ||
    matrix.broadLevel5ImplementationClaimed
  ) {
    throw new Error(`support matrix must remain non-product: ${JSON.stringify(matrix)}`);
  }
  const expected = {
    captureArtifactRealism: 75,
    v8HeapStateRecovery: 63,
    realCrossArchEndToEnd: 65,
    narrowExperimentalProductSupport: 65,
    broadNodeLevel5Support: 15,
    arbitraryProcessCrossArchRestore: 3,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (matrix.readiness[key] !== value) {
      throw new Error(`readiness ${key} expected ${value}, got ${matrix.readiness[key]}`);
    }
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-real-capture-readiness-audit-summary",
    proof: "105",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    auditedProofs: requiredProofs,
    matrixStatus: matrix.status,
    readiness: matrix.readiness,
    requiredBeforeProductClaim: matrix.requiredBeforeProductClaim,
    assertions: {
      allProofBlockSummariesRemainProofOnly: true,
      allProofBlockAssertionsPassed: true,
      supportMatrixRemainsCandidateNotSupported: true,
      narrowExperimentalProductSupportEstimatedAt65Percent:
        matrix.readiness.narrowExperimentalProductSupport === 65,
      broadNodeLevel5StillLow: matrix.readiness.broadNodeLevel5Support <= 15,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_105_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/105/checked-summary.json is stale; rerun with UPDATE_PROOF_105_SUMMARY=1",
    );
  }
  console.log(
    JSON.stringify({
      auditedProofs: requiredProofs.length,
      narrowExperimentalProductSupport: matrix.readiness.narrowExperimentalProductSupport,
    }),
  );
  console.log("proof 105 readiness audit passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
