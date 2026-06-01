#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");

type DecodeResult = {
  accepted: boolean;
  count?: number;
  graphTotal?: number;
  targetStarted: boolean;
  refusal?: { code: string };
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

function hasV8Mapping(dir: string): boolean {
  const maps = JSON.parse(readFileSync(join(dir, "maps.json"), "utf8")) as {
    payload: { mappings: Array<{ name: string }> };
  };
  return maps.payload.mappings.some((mapping) => mapping.name.includes("v8"));
}

function decode(dir: string, id: string): DecodeResult {
  if (!hasV8Mapping(dir)) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-v8-real-map-missing" },
    };
  }
  const resultPath = join(dir, `${id}-decode-result.json`);
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
  return JSON.parse(readFileSync(resultPath, "utf8")) as DecodeResult;
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-098."));
  emitCapture(work);
  const accepted = decode(work, "valid");
  if (
    !accepted.accepted ||
    accepted.count !== 2 ||
    accepted.graphTotal !== 2 ||
    accepted.targetStarted
  ) {
    throw new Error(`real guest memory mapping decode failed: ${JSON.stringify(accepted)}`);
  }
  const target = {
    count: (accepted.count ?? 0) + 1,
    graphTotal: (accepted.graphTotal ?? 0) + 1,
    targetNative: true,
  };
  const noMapDir = mkdtempSync(join(tmpdir(), "machinen-proof-098-nomap."));
  emitCapture(noMapDir);
  const maps = JSON.parse(readFileSync(join(noMapDir, "maps.json"), "utf8")) as Record<string, any>;
  maps.payload.mappings = [{ start: "0x3000", end: "0x4000", name: "plain-heap" }];
  writeFileSync(join(noMapDir, "maps.json"), `${JSON.stringify(maps, null, 2)}\n`);
  const truncatedDir = mkdtempSync(join(tmpdir(), "machinen-proof-098-truncated."));
  emitCapture(truncatedDir);
  writeFileSync(
    join(truncatedDir, "v8-memory.bin"),
    readFileSync(join(truncatedDir, "v8-memory.bin")).subarray(0, 16),
  );
  const cases: Array<[string, string, string]> = [
    ["missing-v8-map", noMapDir, "node-proper-level5-v8-real-map-missing"],
    ["truncated-memory", truncatedDir, "node-proper-level5-v8-byte-marker-missing"],
  ];
  const refusedRows = cases.map(([id, dir, expectedCode]) => {
    const result = decode(dir, id);
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
    kind: "machinen.node-proper-level5-native-v8-real-guest-memory-map-summary",
    proof: "098",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    target,
    refusedRows,
    assertions: {
      nativeDecoderReadRealGuestMemoryMappingArtifact: true,
      v8MapEvidenceRequired: true,
      targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
      invalidMapOrMemoryRefusesBeforeTargetStart: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_098_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/098/checked-summary.json is stale; rerun with UPDATE_PROOF_098_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 098 native V8 decoder over real guest memory map passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
