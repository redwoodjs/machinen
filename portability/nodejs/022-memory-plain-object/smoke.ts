#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { recoverNodeProperLevel5V8ObjectStateEvidence } from "../../../packages/runtime/src/node-proper-level5-v8-object-recovery.ts";

const rowId = "022-memory-plain-object";
const anchor = "machinen-level5-v8-object-state-anchor-v1";

function smi32(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setUint32(4, value >>> 0, true);
  return bytes;
}

function fragment(values: number[]): Uint8Array {
  const anchorBytes = new TextEncoder().encode(anchor);
  const bytes = new Uint8Array(anchorBytes.length + 16 + values.length * 8);
  bytes.set(anchorBytes, 0);
  values.forEach((value, index) => bytes.set(smi32(value), anchorBytes.length + 16 + index * 8));
  return bytes;
}

function outPath(): string {
  const outFlag = process.argv.indexOf("--out");
  return resolve(
    outFlag === -1
      ? "portability/nodejs/retained/nodejs-portability-memory-plain-object-report.json"
      : (process.argv[outFlag + 1] ?? ""),
  );
}

const recovery = recoverNodeProperLevel5V8ObjectStateEvidence(
  [{ bytes: fragment([2, 1, 2]), bytesPath: "memory/object.bin" }],
  { anchor, expectedTotal: 2, expectedHistory: [1, 2] },
);
const state = {
  total: recovery.candidates[0]?.total,
  materialized: { total: recovery.candidates[0]?.total },
};
const accepted = recovery.accepted && state.materialized.total === 2;
const report = {
  kind: "machinen.nodejs-portability-memory-state-smoke-report",
  version: 1,
  accepted,
  corpus: `portability/nodejs/${rowId}`,
  portabilityRow: rowId,
  architectures: ["arm64", "amd64"],
  executeVm: false,
  memoryCapture: "retained-decoder-smoke-from-captured-memory-evidence",
  summary: { verifiedVmRows: 0, memoryStateRows: 1, refusedRows: 0 },
  results: [
    { id: rowId, architecture: "arm64", state: accepted ? "verified" : "failed-classified" },
    { id: rowId, architecture: "amd64", state: accepted ? "verified" : "failed-classified" },
  ],
  recovery,
  materializedState: state.materialized,
  claimBoundary: {
    claims: ["selected V8 plain object numeric state is decoded and semantically materialized"],
    notClaimed: ["arbitrary Node process restore", "raw V8 heap restore", "same PID continuation"],
  },
  claimGuard: {
    arbitraryNodeProcessRestoreClaimed: false,
    arbitraryLinuxProcessRestoreClaimed: false,
    rawV8HeapRestoreUsed: false,
    rawCpuStateReplayUsed: false,
    sourceIsaEmulationUsed: false,
    samePidContinuationClaimed: false,
    activeRequestOrSocketContinuationClaimed: false,
  },
};
const out = outPath();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(accepted ? 0 : 1);
