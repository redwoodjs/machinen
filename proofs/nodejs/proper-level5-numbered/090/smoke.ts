#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../../../..");
const auditedProofs = ["086", "087", "088", "089", "090"];
const forbidden = [
  /production-ready Level 5/i,
  /translated continuation is publicly supported/i,
  /raw cross-architecture CPU restore is supported/i,
  /product support is complete/i,
];

function auditText(label: string, text: string): Array<{ label: string; pattern: string }> {
  return forbidden
    .filter((pattern) => pattern.test(text))
    .map((pattern) => ({ label, pattern: pattern.source }));
}

function main(): void {
  const matrixPath = join(proofDir, "support-matrix.json");
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8")) as Record<string, any>;
  if (
    matrix.productSupportClaimed === true ||
    matrix.broadLevel5ImplementationClaimed === true ||
    matrix.candidateSubset.status !== "candidate-not-supported"
  ) {
    throw new Error(`support matrix overclaimed: ${JSON.stringify(matrix)}`);
  }
  const proofAudits = auditedProofs.map((proof) => {
    const readmePath = join(repoRoot, "proofs", "by-id", proof, "README.md");
    const summaryPath = join(repoRoot, "proofs", "by-id", proof, "checked-summary.json");
    const text = `${readFileSync(readmePath, "utf8")}\n${existsSync(summaryPath) ? readFileSync(summaryPath, "utf8") : ""}`;
    const matches = auditText(`proofs/${proof}`, text);
    return {
      proof,
      proofOnlyLanguage: /proof-only|not product support|out of scope/i.test(text),
      forbiddenMatches: matches,
      accepted: matches.length === 0,
    };
  });
  const publicDocs = ["README.md", "docs/README.md", "docs/quickstart.md"].filter((path) =>
    existsSync(join(repoRoot, path)),
  );
  const publicDocMatches = publicDocs.flatMap((path) =>
    auditText(path, readFileSync(join(repoRoot, path), "utf8")),
  );
  if (proofAudits.some((audit) => !audit.accepted) || publicDocMatches.length > 0) {
    throw new Error(
      `claim audit failed: ${JSON.stringify({ proofAudits, publicDocMatches }, null, 2)}`,
    );
  }
  const cliContract = {
    publicCommandAdded: false,
    privateProofOnlyCommandAllowed: true,
    requiresProofOnlyFlag: matrix.publicCli.requiresProofOnlyFlag === true,
    userFacingStatus: "not-supported-candidate-only",
  };
  const checkedSummary = {
    kind: "machinen.node-proper-level5-cli-docs-support-matrix-summary",
    proof: "090",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    supportMatrix: matrix,
    proofAudits,
    publicDocsAudited: publicDocs,
    publicDocMatches,
    cliContract,
    assertions: {
      candidateSubsetDefinedButNotSupported:
        matrix.candidateSubset.status === "candidate-not-supported",
      noPublicCliSupportAdded: cliContract.publicCommandAdded === false,
      privateCliRequiresProofOnlyFlag: cliContract.requiresProofOnlyFlag,
      docsDoNotAdvertiseProductSupport: publicDocMatches.length === 0,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_090_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/090/checked-summary.json is stale; rerun with UPDATE_PROOF_090_SUMMARY=1",
    );
  }
  console.log(
    JSON.stringify({
      auditedProofs: proofAudits.length,
      publicDocs: publicDocs.length,
      productSupportClaimed: false,
    }),
  );
  console.log("proof 090 CLI docs support matrix proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
