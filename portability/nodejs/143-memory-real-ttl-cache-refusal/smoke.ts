#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "143-memory-real-ttl-cache-refusal",
  rowDir: "portability/nodejs/143-memory-real-ttl-cache-refusal",
  kind: "machinen.nodejs-portability-memory-real-ttl-cache-refusal-smoke-report",
  shape: "ttl-cache",
  anchors: {
    anchor: "machinen-real-ttl-cache-refusal-anchor-v1",
    marker: "cache-policy:ttl-cache-refusal:unsupported",
  },
  semanticState: {
    kind: "ttl-cache-refusal",
    anchor: "machinen-real-ttl-cache-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-ttl-cache-unsupported",
  refusalReason:
    "ttl cache refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
