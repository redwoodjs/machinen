#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");
const repeatedProofs = ["115", "123"];
function runProof(proof: string): Record<string, unknown> {
  const run = spawnSync("pnpm", ["exec", "tsx", `proof/${proof}/smoke.ts`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`proof ${proof} failed:\n${run.stdout}\n${run.stderr}`);
  }
  const summary = JSON.parse(
    readFileSync(join(repoRoot, "proof", proof, "checked-summary.json"), "utf8"),
  ) as Record<string, unknown>;
  return {
    proof,
    assertions: summary.assertions,
    scope: summary.scope,
    productSupportClaimed: summary.productSupportClaimed,
  };
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function main(): void {
  const first = repeatedProofs.map(runProof);
  const second = repeatedProofs.map(runProof);
  const firstDigest = digest(first);
  const secondDigest = digest(second);
  if (firstDigest !== secondDigest) {
    throw new Error(`repeatability digest mismatch: ${firstDigest} ${secondDigest}`);
  }
  const artifactDiff = { changed: false, firstDigest, secondDigest, checkedProofs: repeatedProofs };
  const checkedSummary = {
    kind: "machinen.node-proper-level5-ci-style-repeatability-summary",
    proof: "124",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    automationLane: "repeat proof/115 and proof/123 twice and compare normalized artifacts",
    artifactDiff,
    assertions: {
      ciStyleRepeatabilityLaneRan: true,
      artifactDigestsStable: artifactDiff.changed === false,
      repeatedProofsRemainProofOnly: first.every(
        (item) =>
          item.scope === "proof-only-harness-not-product-support" &&
          item.productSupportClaimed === false,
      ),
      productSupportNotClaimed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_124_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/124/checked-summary.json is stale; rerun with UPDATE_PROOF_124_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ repeatedProofs, stableDigest: firstDigest }));
  console.log("proof 124 CI-style repeatability passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
