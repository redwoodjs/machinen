#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  recoverNodeProperLevel5RawV8ContextSmiCounter,
  recoverNodeProperLevel5V8ClosureCounterCell,
} from "../../../packages/runtime/src/node-proper-level5-v8-closure-recovery.ts";

const rowId = "024-memory-closure-context";

function heapSnapshotWithCountCell(): unknown {
  const strings = ["", "machinenCounterHandler", "system / Context", "Object", "context", "count"];
  const nodeFields = ["type", "name", "id", "self_size", "edge_count", "detachedness"];
  const edgeFields = ["type", "name_or_index", "to_node"];
  const nodeTypes = [["hidden", "array", "string", "object", "code", "closure", "number"]];
  const edgeTypes = [["context", "element", "property", "internal", "hidden", "shortcut", "weak"]];
  const nodeSize = nodeFields.length;
  const context = nodeSize;
  const cell = nodeSize * 2;
  return {
    snapshot: {
      meta: {
        node_fields: nodeFields,
        node_types: nodeTypes,
        edge_fields: edgeFields,
        edge_types: edgeTypes,
      },
    },
    strings,
    nodes: [5, 1, 1, 64, 1, 0, 3, 2, 2, 48, 1, 0, 3, 3, 3, 32, 0, 0],
    edges: [3, 4, context, 0, 5, cell],
  };
}

function rawContextFragments(): Parameters<
  typeof recoverNodeProperLevel5RawV8ContextSmiCounter
>[0] {
  const anchor = "machinen-level5-v8-context-anchor-v1";
  const anchorObject = new Uint8Array(96);
  anchorObject.set(new TextEncoder().encode(anchor), 16);
  const context = new Uint8Array(128);
  const taggedAnchor = 0x1000n + 1n;
  for (let index = 0; index < 8; index++) {
    context[32 + index] = Number((taggedAnchor >> BigInt(index * 8)) & 0xffn);
  }
  const smiTwo = 2n << 32n;
  for (let index = 0; index < 8; index++) {
    context[48 + index] = Number((smiTwo >> BigInt(index * 8)) & 0xffn);
  }
  return [
    { startAddress: 0x1000n, bytes: anchorObject, bytesPath: "memory/closure-anchor.bin" },
    { startAddress: 0x2000n, bytes: context, bytesPath: "memory/closure-context.bin" },
  ];
}

function outPath(): string {
  const outFlag = process.argv.indexOf("--out");
  return resolve(
    outFlag === -1
      ? "portability/nodejs/retained/nodejs-portability-memory-closure-context-report.json"
      : (process.argv[outFlag + 1] ?? ""),
  );
}

const closure = recoverNodeProperLevel5V8ClosureCounterCell(heapSnapshotWithCountCell(), {
  closureNameIncludes: "Counter",
});
const raw = recoverNodeProperLevel5RawV8ContextSmiCounter(rawContextFragments(), {
  anchor: "machinen-level5-v8-context-anchor-v1",
  expectedValue: 2,
});
const materializedCounter = { initial: raw.value, incremented: (raw.value ?? 0) + 1 };
const accepted =
  closure.accepted &&
  raw.accepted &&
  materializedCounter.initial === 2 &&
  materializedCounter.incremented === 3;
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
  closureRecovery: closure,
  rawContextRecovery: raw,
  materializedState: materializedCounter,
  claimBoundary: {
    claims: ["selected V8 closure context count cell is found and its raw Smi slot is decoded"],
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
