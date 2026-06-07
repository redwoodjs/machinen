#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "097-memory-real-random-generator-state-refusal",
  rowDir: "portability/nodejs/097-memory-real-random-generator-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-random-generator-state-refusal-smoke-report",
  shape: "random-generator-state",
  anchors: {
    anchor: "machinen-real-random-generator-state-refusal-anchor-v1",
    marker: "crypto-memory:random-generator-state-refusal:unsupported",
  },
  semanticState: {
    kind: "random-generator-state-refusal",
    anchor: "machinen-real-random-generator-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-random-generator-unsupported",
  refusalReason:
    "random generator state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
