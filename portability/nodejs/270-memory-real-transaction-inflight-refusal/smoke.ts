#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "270-memory-real-transaction-inflight-refusal",
  rowDir: "portability/nodejs/270-memory-real-transaction-inflight-refusal",
  kind: "machinen.nodejs-portability-memory-real-transaction-inflight-refusal-smoke-report",
  shape: "transaction-inflight",
  anchors: {
    anchor: "machinen-real-transaction-inflight-refusal-anchor-v1",
    marker: "in-memory-db:transaction-inflight-refusal:unsupported",
  },
  semanticState: {
    kind: "transaction-inflight-refusal",
    anchor: "machinen-real-transaction-inflight-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-transaction-inflight-unsupported",
  refusalReason:
    "transaction inflight refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
