#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "221-memory-real-monotonic-clock-refusal",
  rowDir: "portability/nodejs/221-memory-real-monotonic-clock-refusal",
  kind: "machinen.nodejs-portability-memory-real-monotonic-clock-refusal-smoke-report",
  shape: "monotonic-clock",
  anchors: {
    anchor: "machinen-real-monotonic-clock-refusal-anchor-v1",
    marker: "date-time:monotonic-clock-refusal:unsupported",
  },
  semanticState: {
    kind: "monotonic-clock-refusal",
    anchor: "machinen-real-monotonic-clock-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-monotonic-clock-unsupported",
  refusalReason:
    "monotonic clock refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
