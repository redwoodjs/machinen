#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");
const required = [
  "process.json",
  "maps.json",
  "fd-table.json",
  "threads.json",
  "tcp.json",
  "v8-memory.bin",
];

type RecordArtifact = {
  kind: string;
  captureTool: string;
  handAuthored: boolean;
  section: string;
  payload: Record<string, unknown>;
};

function validate(dir: string): { accepted: boolean; code: string } {
  for (const file of required) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      return { accepted: false, code: `node-proper-level5-real-zig-guest-capture-${file}-missing` };
    }
    if (file.endsWith(".json")) {
      const artifact = JSON.parse(readFileSync(path, "utf8")) as RecordArtifact;
      if (
        artifact.kind !== "machinen.real-guest-capture-record-v1" ||
        artifact.captureTool !== "proof-096-guest-capture-records-zig" ||
        artifact.handAuthored
      ) {
        return {
          accepted: false,
          code: "node-proper-level5-real-zig-guest-capture-record-invalid",
        };
      }
    }
  }
  return { accepted: true, code: "accepted" };
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-096."));
  const run = spawnSync("zig", ["run", join(proofDir, "guest-capture-records.zig"), "--", work], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(run.stderr);
  }
  const validation = validate(work);
  if (!validation.accepted) {
    throw new Error(`Zig guest capture records refused: ${JSON.stringify(validation)}`);
  }
  const decodeResultPath = join(work, "decode-result.json");
  spawnSync(
    "zig",
    [
      "run",
      join(repoRoot, "proofs/086/native-v8-byte-decoder.zig"),
      "--",
      join(work, "v8-memory.bin"),
      decodeResultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const decoded = JSON.parse(readFileSync(decodeResultPath, "utf8")) as {
    accepted: boolean;
    count: number;
    graphTotal: number;
  };
  if (!decoded.accepted) {
    throw new Error(`native byte decoder refused Zig capture memory: ${JSON.stringify(decoded)}`);
  }
  const target = {
    count: decoded.count + 1,
    graphTotal: decoded.graphTotal + 1,
    targetNative: true,
  };
  const refusedRows = [
    {
      id: "missing-record",
      result: validate(join(tmpdir(), "missing-proof-096")),
      expectedCode: "node-proper-level5-real-zig-guest-capture-process.json-missing",
    },
  ].map((row) => {
    if (row.result.accepted || row.result.code !== row.expectedCode) {
      throw new Error(`${row.id} failed: ${JSON.stringify(row.result)}`);
    }
    return {
      id: row.id,
      expectedCode: row.expectedCode,
      actualCode: row.result.code,
      targetStarted: false,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-zig-guest-capture-records-summary",
    proof: "096",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    requiredRecords: required,
    validation,
    decoded,
    target,
    refusedRows,
    assertions: {
      zigGuestCaptureToolEmittedRecords: true,
      memoryBytesDecodedNatively: decoded.accepted,
      targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
      invalidRecordsRefuseBeforeTargetStart: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_096_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/096/checked-summary.json is stale; rerun with UPDATE_PROOF_096_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 096 Zig guest capture records passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
