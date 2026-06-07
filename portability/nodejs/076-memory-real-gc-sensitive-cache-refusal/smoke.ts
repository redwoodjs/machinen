#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "076-memory-real-gc-sensitive-cache-refusal",
  rowDir: "portability/nodejs/076-memory-real-gc-sensitive-cache-refusal",
  kind: "machinen.nodejs-portability-memory-real-gc-sensitive-cache-refusal-smoke-report",
  shape: "gc-sensitive-cache",
  anchors: {
    anchor: "machinen-real-gc-sensitive-cache-refusal-anchor-v1",
    marker: "weak-gc-state:gc-sensitive-cache-refusal:unsupported",
  },
  semanticState: {
    kind: "gc-sensitive-cache-refusal",
    anchor: "machinen-real-gc-sensitive-cache-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-gc-sensitive-cache-unsupported",
  refusalReason:
    "gc sensitive cache refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
