#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");
const auditedProofs = Array.from({ length: 29 }, (_value, index) =>
  String(index + 126).padStart(3, "0"),
);

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
  remainingBeforeProductClaim: string[];
  exactCandidateSubset: Record<string, unknown>;
};

function main(): void {
  const summaries = auditedProofs.map(
    (proof) =>
      JSON.parse(
        readFileSync(join(repoRoot, "proof", proof, "checked-summary.json"), "utf8"),
      ) as Summary,
  );
  for (const summary of summaries) {
    if (
      summary.scope !== "proof-only-harness-not-product-support" ||
      summary.productSupportClaimed ||
      summary.broadLevel5ImplementationClaimed
    ) {
      throw new Error(`proof ${summary.proof} crossed claim boundary`);
    }
    const failed = Object.entries(summary.assertions).filter(([, value]) => value !== true);
    if (failed.length > 0) {
      throw new Error(`proof ${summary.proof} failed assertions: ${JSON.stringify(failed)}`);
    }
  }
  const matrix = JSON.parse(readFileSync(join(proofDir, "support-matrix.json"), "utf8")) as Matrix;
  if (
    matrix.status !== "candidate-not-supported" ||
    matrix.productSupportClaimed ||
    matrix.broadLevel5ImplementationClaimed
  ) {
    throw new Error(`matrix crossed product boundary: ${JSON.stringify(matrix)}`);
  }
  if (
    matrix.readiness.broadNodeLevel5Support !== 80 ||
    matrix.readiness.narrowExperimentalProductSupport !== 82
  ) {
    throw new Error(`unexpected readiness: ${JSON.stringify(matrix.readiness)}`);
  }
  if (matrix.readiness.arbitraryProcessCrossArchRestore > 5) {
    throw new Error("arbitrary process restore estimate is too high for the evidence");
  }
  const docs = readFileSync(join(proofDir, "EXPERIMENTAL.md"), "utf8");
  if (
    !docs.includes("does not claim product support") ||
    !docs.includes("candidate-not-supported")
  ) {
    throw new Error("experimental docs are missing boundary language");
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-broad-80-readiness-audit-summary",
    proof: "155",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    auditedProofs,
    matrixStatus: matrix.status,
    readiness: matrix.readiness,
    exactCandidateSubset: matrix.exactCandidateSubset,
    remainingBeforeProductClaim: matrix.remainingBeforeProductClaim,
    assertions: {
      auditedProofsRemainProofOnly: true,
      supportMatrixRemainsCandidateNotSupported: true,
      broadNodeLevel5EstimatedAt80Percent: matrix.readiness.broadNodeLevel5Support === 80,
      arbitraryProcessRestoreStillLow: matrix.readiness.arbitraryProcessCrossArchRestore <= 5,
      docsKeepBoundaryLanguage: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_155_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/155/checked-summary.json is stale; rerun with UPDATE_PROOF_155_SUMMARY=1",
    );
  }
  console.log(
    JSON.stringify({
      auditedProofs: auditedProofs.length,
      broadNodeLevel5Support: matrix.readiness.broadNodeLevel5Support,
    }),
  );
  console.log("proof 155 broad 80 readiness audit passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
