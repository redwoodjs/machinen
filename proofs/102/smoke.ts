#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");

type Refusal = { id: string; expectedCode: string; actualCode: string; targetStarted: boolean };
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
function runRecordParser(
  dir: string,
  id: string,
): { accepted: boolean; targetStarted: boolean; refusal?: { code: string } } {
  const resultPath = join(tmpdir(), `machinen-proof-102-${process.pid}-${id}.json`);
  spawnSync(
    "zig",
    ["run", join(repoRoot, "proofs/097/native-record-parser.zig"), "--", dir, resultPath],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(readFileSync(resultPath, "utf8")) as {
    accepted: boolean;
    targetStarted: boolean;
    refusal?: { code: string };
  };
}
function runDecoder(
  dir: string,
  id: string,
): { accepted: boolean; targetStarted: boolean; refusal?: { code: string } } {
  const resultPath = join(dir, `${id}-decode.json`);
  spawnSync(
    "zig",
    [
      "run",
      join(repoRoot, "proofs/086/native-v8-byte-decoder.zig"),
      "--",
      join(dir, "v8-memory.bin"),
      resultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(readFileSync(resultPath, "utf8")) as {
    accepted: boolean;
    targetStarted: boolean;
    refusal?: { code: string };
  };
}
function assertRefused(
  id: string,
  result: { accepted: boolean; targetStarted: boolean; refusal?: { code: string } },
  expectedCode: string,
): Refusal {
  if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
    throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
  }
  return { id, expectedCode, actualCode: result.refusal.code, targetStarted: result.targetStarted };
}
function main(): void {
  const validDir = mkdtempSync(join(tmpdir(), "machinen-proof-102-valid."));
  emitCapture(validDir);
  const accepted = runRecordParser(validDir, "valid");
  if (!accepted.accepted || accepted.targetStarted) {
    throw new Error(`valid capture refused: ${JSON.stringify(accepted)}`);
  }
  const missingDir = mkdtempSync(join(tmpdir(), "machinen-proof-102-missing."));
  emitCapture(missingDir);
  rmSync(join(missingDir, "fd-table.json"));
  const badKindDir = mkdtempSync(join(tmpdir(), "machinen-proof-102-kind."));
  emitCapture(badKindDir);
  const processRecord = JSON.parse(
    readFileSync(join(badKindDir, "process.json"), "utf8"),
  ) as Record<string, unknown>;
  processRecord.kind = "handmade";
  writeFileSync(join(badKindDir, "process.json"), `${JSON.stringify(processRecord, null, 2)}\n`);
  const badToolDir = mkdtempSync(join(tmpdir(), "machinen-proof-102-tool."));
  emitCapture(badToolDir);
  const tcpRecord = JSON.parse(readFileSync(join(badToolDir, "tcp.json"), "utf8")) as Record<
    string,
    unknown
  >;
  tcpRecord.captureTool = "manual";
  writeFileSync(join(badToolDir, "tcp.json"), `${JSON.stringify(tcpRecord, null, 2)}\n`);
  const badMemoryDir = mkdtempSync(join(tmpdir(), "machinen-proof-102-memory."));
  emitCapture(badMemoryDir);
  writeFileSync(join(badMemoryDir, "v8-memory.bin"), "bad-memory");
  const refusedRows = [
    assertRefused(
      "missing-record",
      runRecordParser(missingDir, "missing"),
      "node-proper-level5-native-record-parser-record-missing",
    ),
    assertRefused(
      "bad-record-kind",
      runRecordParser(badKindDir, "kind"),
      "node-proper-level5-native-record-parser-kind-refused",
    ),
    assertRefused(
      "bad-capture-tool",
      runRecordParser(badToolDir, "tool"),
      "node-proper-level5-native-record-parser-tool-refused",
    ),
    assertRefused(
      "bad-memory-bytes",
      runDecoder(badMemoryDir, "memory"),
      "node-proper-level5-v8-byte-marker-missing",
    ),
  ];
  const checkedSummary = {
    kind: "machinen.node-proper-level5-real-capture-negative-gauntlet-summary",
    proof: "102",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      realCaptureNegativeGauntletRan: true,
      eachShortcutRefusedBeforeTargetStart: refusedRows.every((row) => row.targetStarted === false),
      targetMaterializationSkippedForInvalidEvidence: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_102_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/102/checked-summary.json is stale; rerun with UPDATE_PROOF_102_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ refused: refusedRows.length }));
  console.log("proof 102 real capture negative gauntlet passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
