#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "208-memory-real-large-numeric-graph-state",
  rowDir: "portability/nodejs/208-memory-real-large-numeric-graph-state",
  kind: "machinen.nodejs-portability-memory-real-large-numeric-graph-state-smoke-report",
  shape: "large-numeric-graph-state",
  anchors: {
    anchor: "machinen-real-large-numeric-graph-state-anchor-v1",
    marker: "bigint-math:large-numeric-graph-state:unsupported",
  },
  semanticState: {
    kind: "large-numeric-graph-state",
    anchor: "machinen-real-large-numeric-graph-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-large-numeric-graph-unsupported",
  refusalReason:
    "large numeric graph state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
