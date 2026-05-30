#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type DecodeResult = {
  accepted: boolean;
  targetStarted: boolean;
  graphIr?: { total: number; history: number[]; sharedReferenceIdentityPreserved: boolean };
  refusal?: { code: string };
};

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    build: { nodeMajor: 22, v8Major: 12, pointerCompression: true, smiShift: 1 },
    objectMap: "fast-plain-object",
    sharedObjectMap: "fast-shared-object",
    capturedFields: { totalRaw: 4, historyRaw: [2, 4] },
    ...overrides,
  };
}

function decode(work: string, id: string, value: Record<string, unknown>): DecodeResult {
  const inputPath = join(work, `${id}.json`);
  const resultPath = join(work, `${id}-result.json`);
  writeFileSync(inputPath, `${JSON.stringify(value, null, 2)}\n`);
  spawnSync(
    "zig",
    ["run", join(proofDir, "native-v8-object-decoder.zig"), "--", inputPath, resultPath],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (!existsSync(resultPath)) {
    throw new Error(`native object decoder wrote no result for ${id}`);
  }
  return JSON.parse(readFileSync(resultPath, "utf8")) as DecodeResult;
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-099."));
  const accepted = decode(work, "valid", record());
  if (!accepted.accepted || !accepted.graphIr || accepted.targetStarted) {
    throw new Error(`native object decoder refused valid record: ${JSON.stringify(accepted)}`);
  }
  const target = {
    total: accepted.graphIr.total + 1,
    history: [...accepted.graphIr.history, 3],
    sharedReferenceIdentityPreserved: accepted.graphIr.sharedReferenceIdentityPreserved,
    targetNative: true,
  };
  const cases: Array<[string, Record<string, unknown>, string]> = [
    [
      "bad-build",
      record({ build: { nodeMajor: 22, v8Major: 13, pointerCompression: true, smiShift: 1 } }),
      "node-proper-level5-native-v8-build-unsupported",
    ],
    [
      "bad-encoding",
      record({ build: { nodeMajor: 22, v8Major: 12, pointerCompression: false, smiShift: 1 } }),
      "node-proper-level5-native-v8-encoding-unsupported",
    ],
    [
      "bad-map",
      record({ objectMap: "dictionary-map" }),
      "node-proper-level5-native-v8-map-unsupported",
    ],
  ];
  const refusedRows = cases.map(([id, value, expectedCode]) => {
    const result = decode(work, id, value);
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
    kind: "machinen.node-proper-level5-native-build-gated-v8-object-decoder-summary",
    proof: "099",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    acceptedGraphIr: accepted.graphIr,
    target,
    refusedRows,
    assertions: {
      nativeV8ObjectDecoderEmittedGraphIr: true,
      buildAndEncodingGatesEnforced: true,
      targetReturnedNextObjectState: target.total === 3 && target.history.length === 3,
      unsupportedRecordsRefuseBeforeTargetStart: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_099_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/099/checked-summary.json is stale; rerun with UPDATE_PROOF_099_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 099 native build-gated V8 object decoder passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
