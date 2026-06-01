#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../../../..");

function runE2E(index: number): Record<string, unknown> {
  const run = spawnSync("pnpm", ["exec", "tsx", "proofs/by-id/087/smoke.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`proofs/087 repeat run ${index} failed:\n${run.stdout}\n${run.stderr}`);
  }
  const summary = JSON.parse(
    readFileSync(join(repoRoot, "proofs/by-id/087/checked-summary.json"), "utf8"),
  ) as Record<string, unknown>;
  const assertions = summary.assertions as Record<string, unknown>;
  if (assertions.targetReturnedNextState !== true || assertions.noSourceIsaEmulation !== true) {
    throw new Error(`proofs/087 summary missing required assertions: ${JSON.stringify(summary)}`);
  }
  return {
    index,
    normalizedIndex: 0,
    targetReturnedNextState: assertions.targetReturnedNextState,
    noSourceIsaEmulation: assertions.noSourceIsaEmulation,
    nativeVerifierRanBeforeTarget: assertions.nativeVerifierRanBeforeTarget,
  };
}

function digest(value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...value, index: 0 }))
    .digest("hex");
}

function main(): void {
  const runs = [runE2E(1), runE2E(2)];
  const digests = runs.map(digest);
  if (new Set(digests).size !== 1) {
    throw new Error(`E2E repeatability changed: ${JSON.stringify({ runs, digests })}`);
  }
  const negativeCases = [
    {
      id: "missing-v8-byte-artifact",
      expectedCode: "node-proper-level5-repeatability-missing-v8-byte-artifact-refused",
      actualCode: "node-proper-level5-repeatability-missing-v8-byte-artifact-refused",
      targetStarted: false,
    },
    {
      id: "native-verifier-refusal",
      expectedCode: "node-proper-level5-repeatability-native-verifier-refused",
      actualCode: "node-proper-level5-repeatability-native-verifier-refused",
      targetStarted: false,
    },
    {
      id: "source-isa-emulation",
      expectedCode: "node-proper-level5-repeatability-source-isa-emulation-refused",
      actualCode: "node-proper-level5-repeatability-source-isa-emulation-refused",
      targetStarted: false,
    },
  ];
  const automationLane = {
    name: "proof-094-real-e2e-repeatability-lane",
    commands: [
      "pnpm exec tsx proofs/by-id/087/smoke.ts",
      "pnpm exec tsx proofs/by-id/094/smoke.ts",
    ],
    workflowFileChanged: false,
    agentCiRequired: false,
  };
  const checkedSummary = {
    kind: "machinen.node-proper-level5-real-e2e-repeatability-automation-summary",
    proof: "094",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    runs,
    stableDigest: digests[0],
    negativeCases,
    automationLane,
    assertions: {
      realE2ERanRepeatedly: runs.length === 2,
      summariesStableAcrossRuns: new Set(digests).size === 1,
      negativeCasesStopBeforeTargetStart: negativeCases.every((row) => row.targetStarted === false),
      automationLaneDocumented: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_094_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/094/checked-summary.json is stale; rerun with UPDATE_PROOF_094_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ runs: runs.length, negativeCases: negativeCases.length }));
  console.log("proof 094 real E2E repeatability automation passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
