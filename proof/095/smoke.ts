#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type CliResult = {
  accepted: boolean;
  code: string;
  message: string;
  targetStarted: boolean;
  productSupportClaimed: boolean;
  plan?: Record<string, unknown>;
};

function cli(args: string[]): CliResult {
  const run = spawnSync("node", [join(proofDir, "experimental-cli.mjs"), ...args], {
    encoding: "utf8",
  });
  const lines = run.stdout.trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    throw new Error(`CLI produced no JSON: ${run.stderr}`);
  }
  return JSON.parse(lines.at(-1) ?? "{}") as CliResult;
}

function main(): void {
  const matrix = JSON.parse(readFileSync(join(proofDir, "support-matrix.json"), "utf8")) as Record<
    string,
    any
  >;
  if (
    matrix.productSupportClaimed === true ||
    matrix.candidateSubset.status !== "experimental-proof-only-not-supported"
  ) {
    throw new Error(`support matrix overclaimed: ${JSON.stringify(matrix)}`);
  }
  const accepted = cli(["--experimental-translated-continuation", "--proof-only"]);
  if (
    !accepted.accepted ||
    accepted.targetStarted ||
    accepted.productSupportClaimed ||
    accepted.plan?.materialize !== false
  ) {
    throw new Error(`accepted CLI dry-run failed: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, string[], string]> = [
    ["missing-flags", [], "node-proper-level5-cli-experimental-proof-only-required"],
    [
      "unsafe-active-request",
      ["--experimental-translated-continuation", "--proof-only", "--unsafe-active-request"],
      "node-proper-level5-cli-active-request-refused",
    ],
    [
      "product-claim",
      ["--experimental-translated-continuation", "--proof-only", "--claim-product-support"],
      "node-proper-level5-cli-product-claim-refused",
    ],
  ];
  const refusedRows = cases.map(([id, args, expectedCode]) => {
    const result = cli(args);
    if (
      result.accepted ||
      result.code !== expectedCode ||
      result.targetStarted ||
      result.productSupportClaimed
    ) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    if (!result.message || result.message.length < 12) {
      throw new Error(`${id} did not include a clear message: ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.code,
      message: result.message,
      targetStarted: result.targetStarted,
    };
  });
  const docs = readFileSync(join(proofDir, "EXPERIMENTAL.md"), "utf8");
  if (!/proof-only/.test(docs) || /product support is complete/i.test(docs)) {
    throw new Error("experimental docs missing proof-only boundary");
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-experimental-cli-docs-refusal-summary",
    proof: "095",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    supportMatrix: matrix,
    accepted,
    refusedRows,
    docsAudited: ["proof/095/EXPERIMENTAL.md"],
    assertions: {
      experimentalCliRequiresExplicitFlags: true,
      dryRunDoesNotStartTarget: accepted.targetStarted === false,
      refusalErrorsHaveMessages: refusedRows.every((row) => row.message.length > 0),
      supportMatrixSaysNotSupported:
        matrix.candidateSubset.status === "experimental-proof-only-not-supported",
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_095_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/095/checked-summary.json is stale; rerun with UPDATE_PROOF_095_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: accepted.code, refused: refusedRows.length }));
  console.log("proof 095 experimental CLI docs and refusal errors passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
