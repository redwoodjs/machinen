#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "092-memory-real-backpressure-buffer-refusal",
  rowDir: "portability/nodejs/092-memory-real-backpressure-buffer-refusal",
  kind: "machinen.nodejs-portability-memory-real-backpressure-buffer-refusal-smoke-report",
  shape: "backpressure-buffer",
  anchors: {
    anchor: "machinen-real-backpressure-buffer-refusal-anchor-v1",
    marker: "stream-detail:backpressure-buffer-refusal:unsupported",
  },
  semanticState: {
    kind: "backpressure-buffer-refusal",
    anchor: "machinen-real-backpressure-buffer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-backpressure-buffer-unsupported",
  refusalReason:
    "backpressure buffer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
