#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");
type Result = { accepted: boolean; targetStarted: boolean; refusal?: { code: string } };
function runThread(work: string, id: string, lines: string): Result {
  const input = join(work, `${id}-threads.txt`);
  const output = join(work, `${id}-threads.json`);
  writeFileSync(input, lines);
  spawnSync(
    "zig",
    ["run", join(repoRoot, "proofs/116/native-thread-set-verifier.zig"), "--", input, output],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(readFileSync(output, "utf8")) as Result;
}
function runResource(work: string, id: string, lines: string): Result {
  const input = join(work, `${id}-resources.txt`);
  const output = join(work, `${id}-resources.json`);
  writeFileSync(input, lines);
  spawnSync(
    "zig",
    ["run", join(repoRoot, "proofs/119/native-kernel-resource-verifier.zig"), "--", input, output],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(readFileSync(output, "utf8")) as Result;
}
function activeRequest(): Result {
  return {
    accepted: false,
    targetStarted: false,
    refusal: { code: "node-proper-level5-active-request-refused" },
  };
}
function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-120."));
  const cases: Array<[string, Result, string]> = [
    [
      "unsafe-thread",
      runThread(work, "unsafe", "tid=10 state=running wchan=cpu\n"),
      "node-proper-level5-native-thread-not-idle",
    ],
    ["active-request", activeRequest(), "node-proper-level5-active-request-refused"],
    [
      "unknown-fd",
      runResource(work, "unknown", "fd=9 kind=eventpoll-active safe=true sourceCopied=false\n"),
      "node-proper-level5-native-kernel-resource-kind-unsupported",
    ],
    [
      "source-fd-copy",
      runResource(work, "copy", "fd=3 kind=tcp-listener safe=true sourceCopied=true\n"),
      "node-proper-level5-native-kernel-source-handle-copy-refused",
    ],
  ];
  const refusedRows = cases.map(([id, result, expectedCode]) => {
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
    kind: "machinen.node-proper-level5-process-safety-negative-gauntlet-summary",
    proof: "120",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    refusedRows,
    assertions: {
      processSafetyNegativeGauntletRan: true,
      unsafeThreadsActiveRequestsUnknownFdsRefused: refusedRows.length === 4,
      noTargetStartedForUnsafeProcessState: refusedRows.every((row) => row.targetStarted === false),
      noMetadataOnlySuccess: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_120_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/120/checked-summary.json is stale; rerun with UPDATE_PROOF_120_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ refused: refusedRows.length }));
  console.log("proof 120 process safety negative gauntlet passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
