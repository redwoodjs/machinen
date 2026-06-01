#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");
const auditedProofs = Array.from({ length: 19 }, (_value, index) =>
  String(index + 106).padStart(3, "0"),
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
  supportedCandidateSubset: Record<string, unknown>;
  remainingBeforeProductClaim: string[];
};
function main(): void {
  const summaries = auditedProofs.map(
    (proof) =>
      JSON.parse(
        readFileSync(join(repoRoot, "proofs", proof, "checked-summary.json"), "utf8"),
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
    matrix.readiness.broadNodeLevel5Support !== 50 ||
    matrix.readiness.narrowExperimentalProductSupport !== 72
  ) {
    throw new Error(`unexpected readiness: ${JSON.stringify(matrix.readiness)}`);
  }
  const docs = readFileSync(join(proofDir, "EXPERIMENTAL.md"), "utf8");
  if (
    !docs.includes("does not claim product support") ||
    !docs.includes("candidate-not-supported")
  ) {
    throw new Error("experimental docs are missing boundary language");
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-broad-support-readiness-audit-summary",
    proof: "125",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    auditedProofs,
    matrixStatus: matrix.status,
    readiness: matrix.readiness,
    supportedCandidateSubset: matrix.supportedCandidateSubset,
    remainingBeforeProductClaim: matrix.remainingBeforeProductClaim,
    assertions: {
      auditedProofsRemainProofOnly: true,
      supportMatrixRemainsCandidateNotSupported: true,
      broadNodeLevel5EstimatedAt50Percent: matrix.readiness.broadNodeLevel5Support === 50,
      publicExperimentalDocsKeepBoundaryLanguage: true,
      arbitraryProcessRestoreStillNotSupported:
        matrix.readiness.arbitraryProcessCrossArchRestore <= 4,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_125_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/125/checked-summary.json is stale; rerun with UPDATE_PROOF_125_SUMMARY=1",
    );
  }
  console.log(
    JSON.stringify({
      auditedProofs: auditedProofs.length,
      broadNodeLevel5Support: matrix.readiness.broadNodeLevel5Support,
    }),
  );
  console.log("proof 125 broad support readiness audit passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
