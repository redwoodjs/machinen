#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "222-memory-real-performance-timing-refusal",
  rowDir: "portability/nodejs/222-memory-real-performance-timing-refusal",
  kind: "machinen.nodejs-portability-memory-real-performance-timing-refusal-smoke-report",
  shape: "performance-timing",
  anchors: {
    anchor: "machinen-real-performance-timing-refusal-anchor-v1",
    marker: "date-time:performance-timing-refusal:unsupported",
  },
  semanticState: {
    kind: "performance-timing-refusal",
    anchor: "machinen-real-performance-timing-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-performance-timing-unsupported",
  refusalReason:
    "performance timing refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
