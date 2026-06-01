#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");

type VerifyResult = {
  accepted: boolean;
  targetStarted: boolean;
  refusal?: { code: string; section: string; field: string };
};
function emitCapture(dir: string): void {
  const run = spawnSync(
    "zig",
    ["run", join(repoRoot, "proofs/096/guest-capture-records.zig"), "--", dir],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) {
    throw new Error(run.stderr);
  }
}
function buildEvidence(
  dir: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const threads = JSON.parse(readFileSync(join(dir, "threads.json"), "utf8")) as Record<
    string,
    any
  >;
  const fd = JSON.parse(readFileSync(join(dir, "fd-table.json"), "utf8")) as Record<string, any>;
  return {
    allThreadsSafe: threads.payload.threads.every(
      (thread: Record<string, unknown>) => thread.state === "idle",
    ),
    continuationDescriptor: "node-libuv-event-loop-wait-v1",
    resourcesSafe: fd.payload.fds.every((entry: Record<string, unknown>) =>
      String(entry.target).includes("listener"),
    ),
    sourceHandleCopied: false,
    threads: threads.payload.threads,
    resources: fd.payload.fds,
    ...overrides,
  };
}
function verify(work: string, id: string, evidence: Record<string, unknown>): VerifyResult {
  const path = join(work, `${id}-evidence.json`);
  const resultPath = join(work, `${id}-result.json`);
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  spawnSync(
    "zig",
    [
      "run",
      join(repoRoot, "proofs/093/native-process-resource-verifier.zig"),
      "--",
      path,
      resultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(readFileSync(resultPath, "utf8")) as VerifyResult;
}
function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-101."));
  emitCapture(work);
  const accepted = verify(work, "valid", buildEvidence(work));
  if (!accepted.accepted || accepted.targetStarted) {
    throw new Error(
      `native verifier refused capture-derived evidence: ${JSON.stringify(accepted)}`,
    );
  }
  const cases: Array<[string, Record<string, unknown>, string]> = [
    [
      "unsafe-thread",
      buildEvidence(work, { allThreadsSafe: false }),
      "node-proper-level5-native-thread-set-unsafe",
    ],
    [
      "unsafe-resource",
      buildEvidence(work, { resourcesSafe: false }),
      "node-proper-level5-native-resource-set-unsafe",
    ],
    [
      "source-handle-copy",
      buildEvidence(work, { sourceHandleCopied: true }),
      "node-proper-level5-native-source-handle-copy-refused",
    ],
  ];
  const refusedRows = cases.map(([id, evidence, expectedCode]) => {
    const result = verify(work, id, evidence);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.refusal.code,
      section: result.refusal.section,
      field: result.refusal.field,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-capture-derived-native-process-verifier-summary",
    proof: "101",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      verifierConsumedGuestCaptureDerivedThreadEvidence: true,
      verifierConsumedGuestCaptureDerivedResourceEvidence: true,
      refusedRowsStopBeforeTargetStart: true,
      noSourceHandleCopied: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_101_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/101/checked-summary.json is stale; rerun with UPDATE_PROOF_101_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: true, refused: refusedRows.length }));
  console.log("proof 101 capture-derived native process verifier passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
