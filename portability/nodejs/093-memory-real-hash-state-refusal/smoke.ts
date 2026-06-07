#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "093-memory-real-hash-state-refusal",
  rowDir: "portability/nodejs/093-memory-real-hash-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-hash-state-refusal-smoke-report",
  shape: "hash-state",
  anchors: {
    anchor: "machinen-real-hash-state-refusal-anchor-v1",
    marker: "crypto-memory:hash-state-refusal:unsupported",
  },
  semanticState: {
    kind: "hash-state-refusal",
    anchor: "machinen-real-hash-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-hash-unsupported",
  refusalReason:
    "hash state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
