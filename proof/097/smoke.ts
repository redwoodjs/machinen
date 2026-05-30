#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");

type ParserResult = {
  accepted: boolean;
  targetStarted: boolean;
  recordsParsed?: number;
  refusal?: { code: string; record: string };
};

function emitCapture(dir: string): void {
  const run = spawnSync(
    "zig",
    ["run", join(repoRoot, "proof/096/guest-capture-records.zig"), "--", dir],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) {
    throw new Error(run.stderr);
  }
}

function parse(dir: string, id: string): ParserResult {
  const resultPath = join(tmpdir(), `machinen-proof-097-${process.pid}-${id}-parser-result.json`);
  spawnSync("zig", ["run", join(proofDir, "native-record-parser.zig"), "--", dir, resultPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!existsSync(resultPath)) {
    throw new Error(`native parser wrote no result for ${id}`);
  }
  return JSON.parse(readFileSync(resultPath, "utf8")) as ParserResult;
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-097."));
  emitCapture(work);
  const accepted = parse(work, "valid");
  if (!accepted.accepted || accepted.recordsParsed !== 5 || accepted.targetStarted) {
    throw new Error(`native parser refused valid records: ${JSON.stringify(accepted)}`);
  }
  const badKindDir = mkdtempSync(join(tmpdir(), "machinen-proof-097-kind."));
  emitCapture(badKindDir);
  const processRecord = JSON.parse(
    readFileSync(join(badKindDir, "process.json"), "utf8"),
  ) as Record<string, unknown>;
  processRecord.kind = "bad-kind";
  writeFileSync(join(badKindDir, "process.json"), `${JSON.stringify(processRecord, null, 2)}\n`);
  const badToolDir = mkdtempSync(join(tmpdir(), "machinen-proof-097-tool."));
  emitCapture(badToolDir);
  const threads = JSON.parse(readFileSync(join(badToolDir, "threads.json"), "utf8")) as Record<
    string,
    unknown
  >;
  threads.captureTool = "manual";
  writeFileSync(join(badToolDir, "threads.json"), `${JSON.stringify(threads, null, 2)}\n`);
  const cases: Array<[string, string, string]> = [
    ["bad-kind", badKindDir, "node-proper-level5-native-record-parser-kind-refused"],
    ["bad-tool", badToolDir, "node-proper-level5-native-record-parser-tool-refused"],
    [
      "missing",
      join(tmpdir(), "missing-proof-097"),
      "node-proper-level5-native-record-parser-record-missing",
    ],
  ];
  const refusedRows = cases.map(([id, dir, expectedCode]) => {
    const result = parse(dir, id);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.refusal.code,
      record: result.refusal.record,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-native-guest-record-parser-summary",
    proof: "097",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      nativeParserValidatedRealRecordSchema: true,
      allRequiredJsonRecordsParsed: accepted.recordsParsed === 5,
      invalidRecordsRefuseBeforeTargetStart: refusedRows.every(
        (row) => row.targetStarted === false,
      ),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_097_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/097/checked-summary.json is stale; rerun with UPDATE_PROOF_097_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: accepted.recordsParsed, refused: refusedRows.length }));
  console.log("proof 097 native guest record parser passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
