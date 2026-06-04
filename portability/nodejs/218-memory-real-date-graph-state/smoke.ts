#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "218-memory-real-date-graph-state",
  rowDir: "portability/nodejs/218-memory-real-date-graph-state",
  kind: "machinen.nodejs-portability-memory-real-date-graph-state-smoke-report",
  shape: "date-graph-state",
  anchors: {
    anchor: "machinen-real-date-graph-state-anchor-v1",
    marker: "date-time:date-graph-state:unsupported",
  },
  semanticState: {
    kind: "date-graph-state",
    anchor: "machinen-real-date-graph-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-date-graph-unsupported",
  refusalReason:
    "date graph state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
