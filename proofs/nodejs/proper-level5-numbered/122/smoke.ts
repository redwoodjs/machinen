#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type Result = {
  accepted: boolean;
  targetStarted: boolean;
  translatedContinuationUsed?: boolean;
  refusal?: { code: string };
};
function run(args: string[]): Result {
  const child = spawnSync("node", [join(proofDir, "experimental-restore-cli.mjs"), ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse((child.status === 0 ? child.stdout : child.stderr).trim()) as Result;
}
function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-122."));
  const manifestPath = join(work, "capture-manifest.json");
  const outPath = join(work, "restore-result.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        proofOnly: true,
        records: ["process", "threads", "resources", "v8-graph"],
        productSupportClaimed: false,
      },
      null,
      2,
    ),
  );
  const accepted = run([
    "--proof-only",
    "--experimental-node-level5",
    "--capture-manifest",
    manifestPath,
    "--out",
    outPath,
  ]);
  if (
    !accepted.accepted ||
    accepted.targetStarted ||
    !accepted.translatedContinuationUsed ||
    !existsSync(outPath)
  ) {
    throw new Error(`restore CLI failed: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, string[], string]> = [
    [
      "missing-flags",
      ["--capture-manifest", manifestPath, "--out", outPath],
      "node-proper-level5-restore-cli-experimental-flags-required",
    ],
    [
      "raw-cpu",
      [
        "--proof-only",
        "--experimental-node-level5",
        "--raw-cpu-restore",
        "--capture-manifest",
        manifestPath,
        "--out",
        outPath,
      ],
      "node-proper-level5-restore-cli-raw-cpu-refused",
    ],
    [
      "missing-manifest",
      [
        "--proof-only",
        "--experimental-node-level5",
        "--capture-manifest",
        join(work, "missing.json"),
        "--out",
        outPath,
      ],
      "node-proper-level5-restore-cli-manifest-missing",
    ],
  ];
  const refusedRows = cases.map(([id, args, expectedCode]) => {
    const result = run(args);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} failed: ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.refusal.code,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-experimental-restore-cli-summary",
    proof: "122",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      experimentalRestoreCliExists: true,
      translatedContinuationRequired: true,
      rawCpuRestoreRefused: true,
      explicitFlagsRequired: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_122_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/122/checked-summary.json is stale; rerun with UPDATE_PROOF_122_SUMMARY=1",
    );
  }
  console.log(
    JSON.stringify({
      translatedContinuationUsed: accepted.translatedContinuationUsed,
      refused: refusedRows.length,
    }),
  );
  console.log("proof 122 experimental restore CLI passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
