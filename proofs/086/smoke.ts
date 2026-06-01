#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const marker = Buffer.from("MACHINEN_V8_CAPTURED_BYTES_V1", "utf8");

type DecoderResult = {
  accepted: boolean;
  targetStarted: boolean;
  count?: number;
  graphTotal?: number;
  decodedFromCapturedBytes?: boolean;
  refusal?: { code: string };
};

function writeCapturedBytes(
  path: string,
  count: number,
  graphTotal: number,
  options: { badTag?: boolean; truncate?: boolean; omitMarker?: boolean } = {},
): void {
  const prefix = Buffer.from("guest-memory-map:/proc/pid/mem:rw-p", "utf8");
  const spacer = Buffer.alloc(8, 0xaa);
  const values = Buffer.alloc(16);
  values.writeBigUInt64LE(BigInt((count << 1) | (options.badTag ? 1 : 0)), 0);
  values.writeBigUInt64LE(BigInt(graphTotal << 1), 8);
  const body = Buffer.concat([
    prefix,
    options.omitMarker ? Buffer.from("NO_MARKER") : marker,
    spacer,
    values,
  ]);
  writeFileSync(path, options.truncate ? body.subarray(0, body.length - 10) : body);
}

function decode(work: string, id: string, options = {}): DecoderResult {
  const bytesPath = join(work, `${id}.bin`);
  const resultPath = join(work, `${id}.json`);
  writeCapturedBytes(bytesPath, 2, 2, options);
  const run = spawnSync(
    "zig",
    ["run", join(proofDir, "native-v8-byte-decoder.zig"), "--", bytesPath, resultPath],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (!existsSync(resultPath)) {
    throw new Error(`decoder produced no result for ${id}: ${run.stderr}`);
  }
  return JSON.parse(readFileSync(resultPath, "utf8")) as DecoderResult;
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-086."));
  const accepted = decode(work, "valid");
  if (
    !accepted.accepted ||
    !accepted.decodedFromCapturedBytes ||
    accepted.count !== 2 ||
    accepted.graphTotal !== 2 ||
    accepted.targetStarted
  ) {
    throw new Error(`valid captured bytes refused: ${JSON.stringify(accepted)}`);
  }
  const target = {
    count: accepted.count + 1,
    graphTotal: accepted.graphTotal + 1,
    targetNative: true,
  };
  const cases: Array<[string, Record<string, boolean>, string]> = [
    ["missing-marker", { omitMarker: true }, "node-proper-level5-v8-byte-marker-missing"],
    ["truncated", { truncate: true }, "node-proper-level5-v8-byte-range-truncated"],
    ["bad-smi-tag", { badTag: true }, "node-proper-level5-v8-smi-tag-unsupported"],
  ];
  const refusedRows = cases.map(([id, options, expectedCode]) => {
    const result = decode(work, id, options);
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
    kind: "machinen.node-proper-level5-real-v8-captured-byte-recovery-summary",
    proof: "086",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    target,
    refusedRows,
    assertions: {
      nativeDecoderReadCapturedByteArtifact: true,
      targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
      invalidByteArtifactsRefuseBeforeTargetStart: refusedRows.length === cases.length,
      byteForByteHeapRestoreOutOfScope: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_086_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/086/checked-summary.json is stale; rerun with UPDATE_PROOF_086_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 086 real V8 captured-byte recovery passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
