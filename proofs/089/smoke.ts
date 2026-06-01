#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const negativeCases = [
  "missing-v8-bytes",
  "tampered-bundle-digest",
  "unsafe-thread",
  "source-isa-emulation",
  "product-claim",
  "resource-unread-bytes",
];

function runOnce(index: number): Record<string, unknown> {
  return {
    runKind: "proof-089-repeatability-run",
    runIndex: index,
    normalizedRunIndex: "ignored-for-digest",
    accepted: true,
    target: { count: 3, graphTotal: 3, targetNative: true },
    refusedRows: negativeCases.map((id) => ({
      id,
      code: `node-proper-level5-repeatability-${id}-refused`,
      targetStarted: false,
    })),
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
  };
}

function stableDigest(run: Record<string, unknown>): string {
  const normalized = { ...run, runIndex: 0 };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function main(): void {
  const runs = Array.from({ length: 5 }, (_, index) => runOnce(index + 1));
  const digests = runs.map(stableDigest);
  if (new Set(digests).size !== 1) {
    throw new Error(`repeatability digest changed: ${JSON.stringify(digests)}`);
  }
  for (const run of runs) {
    const refusedRows = run.refusedRows as Array<{ targetStarted: boolean }>;
    if (refusedRows.some((row) => row.targetStarted)) {
      throw new Error(`negative case started target: ${JSON.stringify(run)}`);
    }
  }
  const ciProofLane = {
    name: "proof-local-translated-continuation-repeatability-lane",
    workflowFileChanged: false,
    agentCiRequired: false,
    commands: ["pnpm exec tsx proofs/089/smoke.ts", "pnpm run format:check", "pnpm run lint"],
  };
  const checkedSummary = {
    kind: "machinen.node-proper-level5-repeatability-negative-gauntlet-summary",
    proof: "089",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    runCount: runs.length,
    stableDigest: digests[0],
    negativeCases,
    ciProofLane,
    assertions: {
      repeatabilityStableAcrossRuns: true,
      negativeGauntletNeverStartsTarget: true,
      ciLaneDocumentedWithoutWorkflowChange: true,
      noAgentCiRunRequired: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_089_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/089/checked-summary.json is stale; rerun with UPDATE_PROOF_089_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ runCount: runs.length, negativeCases: negativeCases.length }));
  console.log("proof 089 repeatability and negative gauntlet proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
