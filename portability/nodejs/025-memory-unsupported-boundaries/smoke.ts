#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { recoverNodeProperLevel5V8ClosureCounterCell } from "../../../packages/runtime/src/node-proper-level5-v8-closure-recovery.ts";
import {
  recoverNodeProperLevel5V8ObjectStateEvidence,
  type NodeProperLevel5V8ObjectRecoveryRefusalCode,
} from "../../../packages/runtime/src/node-proper-level5-v8-object-recovery.ts";

const rowId = "025-memory-unsupported-boundaries";
const anchor = "machinen-level5-v8-object-state-anchor-v1";
const unsupportedObjectShapes: NodeProperLevel5V8ObjectRecoveryRefusalCode[] = [
  "node-proper-level5-v8-object-hidden-class-unsupported",
  "node-proper-level5-v8-object-sparse-array-unsupported",
  "node-proper-level5-v8-object-accessor-unsupported",
  "node-proper-level5-v8-object-proxy-unsupported",
  "node-proper-level5-v8-object-symbol-key-unsupported",
  "node-proper-level5-v8-object-external-string-unsupported",
  "node-proper-level5-v8-object-elements-kind-unsupported",
];

function outPath(): string {
  const outFlag = process.argv.indexOf("--out");
  return resolve(
    outFlag === -1
      ? "portability/nodejs/retained/nodejs-portability-memory-unsupported-boundaries-report.json"
      : (process.argv[outFlag + 1] ?? ""),
  );
}

const objectRefusals = unsupportedObjectShapes.map((code) =>
  recoverNodeProperLevel5V8ObjectStateEvidence([{ bytes: new Uint8Array(32) }], {
    anchor,
    expectedTotal: 2,
    expectedHistory: [1, 2],
    unsupportedShape: code,
  }),
);
const malformedClosure = recoverNodeProperLevel5V8ClosureCounterCell({});
const accepted =
  objectRefusals.every(
    (result, index) => result.refusals[0]?.code === unsupportedObjectShapes[index],
  ) && malformedClosure.refusals[0]?.code === "node-proper-level5-v8-heap-snapshot-malformed";
const report = {
  kind: "machinen.nodejs-portability-memory-state-refusal-smoke-report",
  version: 1,
  accepted,
  corpus: `portability/nodejs/${rowId}`,
  portabilityRow: rowId,
  architectures: ["arm64", "amd64"],
  executeVm: false,
  memoryCapture: "retained-decoder-refusal-smoke",
  summary: { verifiedVmRows: 0, memoryStateRows: 0, refusedRows: 1 },
  results: [
    {
      id: rowId,
      architecture: "arm64",
      state: "refused",
      refusalCode: "node-portability-memory-unsupported-boundaries-unsupported",
    },
    {
      id: rowId,
      architecture: "amd64",
      state: "refused",
      refusalCode: "node-portability-memory-unsupported-boundaries-unsupported",
    },
  ],
  objectRefusals,
  closureRefusal: malformedClosure,
  claimBoundary: {
    claims: ["unsupported V8 object and closure memory shapes refuse fail-closed"],
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
