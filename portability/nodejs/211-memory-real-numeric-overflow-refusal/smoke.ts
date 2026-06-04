#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "211-memory-real-numeric-overflow-refusal",
  rowDir: "portability/nodejs/211-memory-real-numeric-overflow-refusal",
  kind: "machinen.nodejs-portability-memory-real-numeric-overflow-refusal-smoke-report",
  shape: "numeric-overflow",
  anchors: {
    anchor: "machinen-real-numeric-overflow-refusal-anchor-v1",
    marker: "bigint-math:numeric-overflow-refusal:unsupported",
  },
  semanticState: {
    kind: "numeric-overflow-refusal",
    anchor: "machinen-real-numeric-overflow-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-numeric-overflow-unsupported",
  refusalReason:
    "numeric overflow refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
