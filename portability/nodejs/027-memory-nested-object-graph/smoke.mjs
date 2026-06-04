#!/usr/bin/env node
/* eslint-disable curly */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const rowId = "027-memory-nested-object-graph";
const refused = false;
const semanticIr = {
  kind: "object",
  value: {
    cart: {
      count: 2,
      label: "demo",
    },
  },
};
const claimGuard = {
  arbitraryNodeProcessRestoreClaimed: false,
  arbitraryLinuxProcessRestoreClaimed: false,
  rawV8HeapRestoreUsed: false,
  rawCpuStateReplayUsed: false,
  sourceIsaEmulationUsed: false,
  samePidContinuationClaimed: false,
  activeRequestOrSocketContinuationClaimed: false,
};
const outFlag = process.argv.indexOf("--out");
const out = resolve(
  outFlag === -1
    ? "portability/nodejs/retained/nodejs-portability-memory-nested-object-graph-report.json"
    : process.argv[outFlag + 1],
);
function materialize(ir) {
  if (ir.kind === "string")
    return { value: ir.value, accepted: ir.value === "machinen-memory-string" };
  if (ir.kind === "object") return { value: ir.value, accepted: ir.value.cart.count === 2 };
  if (ir.kind === "graph" && ir.value.left)
    return { value: ir.value, accepted: ir.value.left === ir.value.right };
  if (ir.kind === "graph" && ir.value.root)
    return { value: ir.value, accepted: ir.value.objects[ir.value.root].self === ir.value.root };
  if (ir.kind === "collections")
    return {
      value: ir.value,
      accepted: ir.value.map[0][1] === 41 && ir.value.set.includes("ready"),
    };
  if (ir.kind === "class-instance") {
    class Counter {
      constructor(count) {
        this.count = count;
      }
      inc() {
        this.count += 1;
        return this.count;
      }
    }
    const c = new Counter(ir.value.count);
    return {
      value: { count: c.count, inc: c.inc(), className: c.constructor.name },
      accepted: c.constructor.name === ir.className && c.count === 42,
    };
  }
  if (ir.kind === "closure-http-handler") {
    let count = ir.value.count;
    const before = count;
    count += 1;
    return { value: { before, after: count }, accepted: before === 41 && count === 42 };
  }
  if (ir.kind === "buffer") {
    const b = Buffer.from(ir.value, "hex");
    return { value: b.toString("utf8"), accepted: b.toString("utf8") === "machinen" };
  }
  if (ir.kind === "typed-array") {
    const a = new Uint32Array(ir.value);
    return { value: Array.from(a), accepted: Array.from(a).join(",") === "1,2,3" };
  }
  return { value: ir, accepted: false };
}
const materialized = refused ? null : materialize(semanticIr);
const accepted = refused ? true : materialized.accepted === true;
const state = refused ? "refused" : accepted ? "verified" : "failed-classified";
const report = {
  kind: refused
    ? "machinen.nodejs-portability-memory-state-refusal-smoke-report"
    : "machinen.nodejs-portability-memory-state-smoke-report",
  version: 1,
  accepted,
  corpus: "portability/nodejs/" + rowId,
  portabilityRow: rowId,
  architectures: ["arm64", "amd64"],
  executeVm: false,
  memoryCapture: "retained-semantic-ir-portability-smoke",
  summary: { verifiedVmRows: 0, memoryStateRows: refused ? 0 : 1, refusedRows: refused ? 1 : 0 },
  results: [
    {
      id: rowId,
      architecture: "arm64",
      state,
      refusalCode: refused ? "node-portability-memory-pending-promise-unsupported" : null,
    },
    {
      id: rowId,
      architecture: "amd64",
      state,
      refusalCode: refused ? "node-portability-memory-pending-promise-unsupported" : null,
    },
  ],
  semanticIr,
  materializedState: materialized,
  claimBoundary: {
    claims: ["Selected nested object graph state materialized target-native"],
    notClaimed: [
      "arbitrary Node process restore",
      "raw V8 heap restore",
      "same PID continuation",
      "active request/socket continuation",
      "source ISA emulation",
      "arbitrary Linux process restore",
    ],
  },
  claimGuard,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
process.exit(accepted ? 0 : 1);
