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
  nativeVerifierStarted: boolean;
  refusal?: { code: string; section: string; field: string };
};

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    allThreadsSafe: true,
    continuationDescriptor: "node-libuv-event-loop-wait-v1",
    resourcesSafe: true,
    sourceHandleCopied: false,
    threads: [
      { id: "main", state: "idle" },
      { id: "worker", state: "idle" },
    ],
    resources: [{ kind: "tcp-listener-v1" }, { kind: "repeating-timer-v1" }],
    ...overrides,
  };
}

function verify(work: string, id: string, value: Record<string, unknown>): Result {
  const evidencePath = join(work, `${id}.json`);
  const resultPath = join(work, `${id}-result.json`);
  writeFileSync(evidencePath, `${JSON.stringify(value, null, 2)}\n`);
  const run = spawnSync(
    "zig",
    ["run", join(proofDir, "native-process-resource-verifier.zig"), "--", evidencePath, resultPath],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (!existsSync(resultPath)) {
    throw new Error(`native verifier wrote no result for ${id}: ${run.stderr}`);
  }
  return JSON.parse(readFileSync(resultPath, "utf8")) as Result;
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-093."));
  const accepted = verify(work, "valid", evidence());
  if (!accepted.accepted || accepted.targetStarted || !accepted.nativeVerifierStarted) {
    throw new Error(`valid evidence refused: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, Record<string, unknown>, string, string]> = [
    [
      "unsafe-thread",
      evidence({ allThreadsSafe: false }),
      "node-proper-level5-native-thread-set-unsafe",
      "threads",
    ],
    [
      "unsafe-resource",
      evidence({ resourcesSafe: false }),
      "node-proper-level5-native-resource-set-unsafe",
      "resources",
    ],
    [
      "source-handle-copy",
      evidence({ sourceHandleCopied: true }),
      "node-proper-level5-native-source-handle-copy-refused",
      "resources",
    ],
    [
      "missing-continuation",
      evidence({ continuationDescriptor: "missing" }),
      "node-proper-level5-native-continuation-descriptor-missing",
      "threads",
    ],
  ];
  const refusedRows = cases.map(([id, value, expectedCode, section]) => {
    const result = verify(work, id, value);
    if (
      result.accepted ||
      result.refusal?.code !== expectedCode ||
      result.refusal.section !== section ||
      result.targetStarted
    ) {
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
    kind: "machinen.node-proper-level5-native-process-resource-verifier-summary",
    proof: "093",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      nativeVerifierChecksWholeThreadSet: true,
      nativeVerifierChecksResourceSet: true,
      typedRefusalReportsIncludeSectionAndField: true,
      refusedRowsStopBeforeTargetStart: refusedRows.every((row) => row.targetStarted === false),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_093_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/093/checked-summary.json is stale; rerun with UPDATE_PROOF_093_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: accepted.accepted, refused: refusedRows.length }));
  console.log("proof 093 native whole-process thread/resource verifier passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
