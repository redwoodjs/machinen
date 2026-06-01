#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../../../..");

type CliResult = {
  accepted: boolean;
  targetStarted: boolean;
  proof?: string;
  consumedProof?: string;
  refusal?: { code: string };
};
function runCli(args: string[]): CliResult {
  const run = spawnSync("node", [join(proofDir, "experimental-cli.mjs"), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stream = run.status === 0 ? run.stdout : run.stderr;
  return JSON.parse(stream.trim()) as CliResult;
}
function main(): void {
  const proof100 = spawnSync("pnpm", ["exec", "tsx", "proofs/by-id/100/smoke.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proof100.status !== 0) {
    throw new Error(`proof 100 prerequisite failed:\n${proof100.stdout}\n${proof100.stderr}`);
  }
  const accepted = runCli([
    "--proof-only",
    "--experimental-translated-continuation",
    "--proof-100-summary",
    "proofs/by-id/100/checked-summary.json",
  ]);
  if (!accepted.accepted || accepted.targetStarted || accepted.consumedProof !== "100") {
    throw new Error(`experimental CLI refused real-capture summary: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, string[], string]> = [
    [
      "missing-flags",
      ["--proof-100-summary", "proofs/by-id/100/checked-summary.json"],
      "node-proper-level5-experimental-cli-proof-flags-required",
    ],
    [
      "product-claim",
      [
        "--proof-only",
        "--experimental-translated-continuation",
        "--claim-product-support",
        "--proof-100-summary",
        "proofs/by-id/100/checked-summary.json",
      ],
      "node-proper-level5-experimental-cli-product-claim-refused",
    ],
    [
      "missing-summary",
      [
        "--proof-only",
        "--experimental-translated-continuation",
        "--proof-100-summary",
        "proofs/by-id/100/missing.json",
      ],
      "node-proper-level5-experimental-cli-summary-missing",
    ],
  ];
  const refusedRows = cases.map(([id, args, expectedCode]) => {
    const result = runCli(args);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.refusal.code,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-real-capture-experimental-cli-summary",
    proof: "104",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    docs: "proofs/by-id/104/EXPERIMENTAL.md",
    assertions: {
      cliConsumesRealCaptureE2eSummary: true,
      explicitProofOnlyFlagsRequired: true,
      productClaimAttemptRefused: true,
      targetNotStartedByCliBoundary: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_104_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/104/checked-summary.json is stale; rerun with UPDATE_PROOF_104_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: true, refused: refusedRows.length }));
  console.log("proof 104 experimental CLI boundary passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
