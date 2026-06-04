#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "281-memory-real-leaky-bucket-state",
  rowDir: "portability/nodejs/281-memory-real-leaky-bucket-state",
  kind: "machinen.nodejs-portability-memory-real-leaky-bucket-state-smoke-report",
  shape: "leaky-bucket-state",
  anchors: {
    anchor: "machinen-real-leaky-bucket-state-anchor-v1",
    marker: "rate-limiting:leaky-bucket-state:unsupported",
  },
  semanticState: {
    kind: "leaky-bucket-state",
    anchor: "machinen-real-leaky-bucket-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-leaky-bucket-unsupported",
  refusalReason:
    "leaky bucket state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
