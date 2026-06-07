#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "147-memory-real-cache-weak-values-refusal",
  rowDir: "portability/nodejs/147-memory-real-cache-weak-values-refusal",
  kind: "machinen.nodejs-portability-memory-real-cache-weak-values-refusal-smoke-report",
  shape: "cache-weak-values",
  anchors: {
    anchor: "machinen-real-cache-weak-values-refusal-anchor-v1",
    marker: "cache-policy:cache-weak-values-refusal:unsupported",
  },
  semanticState: {
    kind: "cache-weak-values-refusal",
    anchor: "machinen-real-cache-weak-values-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-cache-weak-values-unsupported",
  refusalReason:
    "cache weak values refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
