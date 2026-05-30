#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");
const auditedProofs = Array.from({ length: 14 }, (_value, index) =>
  String(index + 156).padStart(3, "0"),
);
type Summary = {
  proof: string;
  scope: string;
  productSupportClaimed: boolean;
  broadLevel5ImplementationClaimed: boolean;
  declaredSubsetCoverage: number;
  assertions: Record<string, boolean>;
};
type Matrix = {
  status: string;
  productSupportClaimed: boolean;
  broadLevel5ImplementationClaimed: boolean;
  readiness: Record<string, number>;
  notSupported: string[];
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
    if (summary.declaredSubsetCoverage !== 100) {
      throw new Error(`proof ${summary.proof} did not reach declared subset coverage`);
    }
    const failed = Object.entries(summary.assertions).filter(([, value]) => value !== true);
    if (failed.length > 0) {
      throw new Error(`proof ${summary.proof} failed assertions: ${JSON.stringify(failed)}`);
    }
  }
  const matrix = JSON.parse(readFileSync(join(proofDir, "support-matrix.json"), "utf8")) as Matrix;
  if (
    matrix.productSupportClaimed ||
    matrix.broadLevel5ImplementationClaimed ||
    !matrix.status.includes("candidate-not-supported")
  ) {
    throw new Error(`matrix crossed product boundary: ${JSON.stringify(matrix)}`);
  }
  if (
    matrix.readiness.declaredExperimentalSubsetCoverage !== 100 ||
    matrix.readiness.broadNodeLevel5ProductSupport !== 0
  ) {
    throw new Error(`unexpected readiness: ${JSON.stringify(matrix.readiness)}`);
  }
  const docs = readFileSync(join(proofDir, "EXPERIMENTAL.md"), "utf8");
  if (!docs.includes("does not claim product support") || !docs.includes("100%")) {
    throw new Error("docs missing boundary language");
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-declared-subset-100-audit-summary",
    proof: "170",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    auditedProofs,
    matrixStatus: matrix.status,
    readiness: matrix.readiness,
    notSupported: matrix.notSupported,
    assertions: {
      auditedProofsRemainProofOnly: true,
      declaredExperimentalSubsetCoverageIs100Percent:
        matrix.readiness.declaredExperimentalSubsetCoverage === 100,
      broadNodeProductSupportNotClaimed: matrix.readiness.broadNodeLevel5ProductSupport === 0,
      arbitraryProcessRestoreStillLow: matrix.readiness.arbitraryProcessCrossArchRestore <= 5,
      docsKeepBoundaryLanguage: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_170_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/170/checked-summary.json is stale; rerun with UPDATE_PROOF_170_SUMMARY=1",
    );
  }
  console.log(
    JSON.stringify({
      auditedProofs: auditedProofs.length,
      declaredSubsetCoverage: matrix.readiness.declaredExperimentalSubsetCoverage,
    }),
  );
  console.log("proof 170 declared subset 100 audit passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
