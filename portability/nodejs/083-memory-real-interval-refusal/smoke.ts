#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "083-memory-real-interval-refusal",
  rowDir: "portability/nodejs/083-memory-real-interval-refusal",
  kind: "machinen.nodejs-portability-memory-real-interval-refusal-smoke-report",
  shape: "interval",
  anchors: {
    anchor: "machinen-real-interval-refusal-anchor-v1",
    marker: "timer-detail:interval-refusal:unsupported",
  },
  semanticState: {
    kind: "interval-refusal",
    anchor: "machinen-real-interval-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-interval-unsupported",
  refusalReason:
    "interval refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
