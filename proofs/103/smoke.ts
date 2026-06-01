#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");

type RunSummary = {
  response: {
    count: number;
    graphTotal: number;
    processArch: string;
    sourceIsaEmulationUsed: boolean;
  };
  assertions: Record<string, boolean>;
};
function digest(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function runProof100(index: number): RunSummary {
  const run = spawnSync("pnpm", ["exec", "tsx", "proofs/100/smoke.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`proof 100 run ${index} failed:\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(
    readFileSync(join(repoRoot, "proofs/100/checked-summary.json"), "utf8"),
  ) as RunSummary;
}
function normalize(summary: RunSummary): Record<string, unknown> {
  return {
    response: summary.response,
    assertions: summary.assertions,
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
  };
}
function main(): void {
  const runs = [runProof100(1), runProof100(2)];
  const normalized = runs.map(normalize);
  const digests = normalized.map(digest);
  if (digests[0] !== digests[1]) {
    throw new Error(`Proof 100 repeatability digest mismatch: ${JSON.stringify(digests)}`);
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-real-capture-e2e-repeatability-summary",
    proof: "103",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    automationLane: "pnpm exec tsx proofs/100/smoke.ts repeated twice",
    runCount: runs.length,
    stableDigest: digests[0],
    normalized,
    assertions: {
      realCaptureE2eRepeated: true,
      normalizedDigestsStable: digests[0] === digests[1],
      amd64TargetReturnedNextStateBothRuns: runs.every(
        (run) =>
          run.response.count === 3 &&
          run.response.graphTotal === 3 &&
          run.response.processArch === "amd64",
      ),
      noSourceIsaEmulationBothRuns: runs.every(
        (run) => run.response.sourceIsaEmulationUsed === false,
      ),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_103_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/103/checked-summary.json is stale; rerun with UPDATE_PROOF_103_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ runCount: runs.length, stableDigest: digests[0] }));
  console.log("proof 103 real capture E2E repeatability passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
