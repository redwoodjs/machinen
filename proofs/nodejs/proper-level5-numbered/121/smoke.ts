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
  out?: string;
  refusal?: { code: string };
};
function run(args: string[]): Result {
  const child = spawnSync("node", [join(proofDir, "experimental-capture-cli.mjs"), ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse((child.status === 0 ? child.stdout : child.stderr).trim()) as Result;
}
function main(): void {
  const out = mkdtempSync(join(tmpdir(), "machinen-proof-121."));
  const accepted = run(["--proof-only", "--experimental-node-level5", "--out", out]);
  if (
    !accepted.accepted ||
    accepted.targetStarted ||
    !existsSync(join(out, "capture-manifest.json"))
  ) {
    throw new Error(`capture CLI failed: ${JSON.stringify(accepted)}`);
  }
  const manifest = JSON.parse(readFileSync(join(out, "capture-manifest.json"), "utf8")) as {
    records: string[];
    proofOnly: boolean;
  };
  const cases: Array<[string, string[], string]> = [
    ["missing-flags", ["--out", out], "node-proper-level5-capture-cli-experimental-flags-required"],
    [
      "product-claim",
      ["--proof-only", "--experimental-node-level5", "--claim-product-support", "--out", out],
      "node-proper-level5-capture-cli-product-claim-refused",
    ],
    [
      "missing-output",
      ["--proof-only", "--experimental-node-level5"],
      "node-proper-level5-capture-cli-output-required",
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
    kind: "machinen.node-proper-level5-experimental-capture-cli-summary",
    proof: "121",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted: { ...accepted, out: "proof-output-dir" },
    manifest,
    refusedRows,
    assertions: {
      experimentalCaptureCliExists: true,
      explicitFlagsRequired: true,
      captureManifestWritten: manifest.records.length === 4,
      productClaimRefused: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_121_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/121/checked-summary.json is stale; rerun with UPDATE_PROOF_121_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ records: manifest.records.length, refused: refusedRows.length }));
  console.log("proof 121 experimental capture CLI passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
