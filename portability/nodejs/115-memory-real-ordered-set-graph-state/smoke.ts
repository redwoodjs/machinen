#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "115-memory-real-ordered-set-graph-state",
  rowDir: "portability/nodejs/115-memory-real-ordered-set-graph-state",
  kind: "machinen.nodejs-portability-memory-real-ordered-set-graph-state-smoke-report",
  shape: "ordered-set-graph-state",
  anchors: {
    anchor: "machinen-real-ordered-set-graph-state-anchor-v1",
    marker: "collections-advanced:ordered-set-graph-state:unsupported",
  },
  semanticState: {
    kind: "ordered-set-graph-state",
    anchor: "machinen-real-ordered-set-graph-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-ordered-set-graph-unsupported",
  refusalReason:
    "ordered set graph state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
