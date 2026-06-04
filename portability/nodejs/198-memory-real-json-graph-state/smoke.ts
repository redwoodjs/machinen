#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "198-memory-real-json-graph-state",
  rowDir: "portability/nodejs/198-memory-real-json-graph-state",
  kind: "machinen.nodejs-portability-memory-real-json-graph-state-smoke-report",
  shape: "json-graph-state",
  anchors: {
    anchor: "machinen-real-json-graph-state-anchor-v1",
    marker: "serialization:json-graph-state:unsupported",
  },
  semanticState: {
    kind: "json-graph-state",
    anchor: "machinen-real-json-graph-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-json-graph-unsupported",
  refusalReason:
    "json graph state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
