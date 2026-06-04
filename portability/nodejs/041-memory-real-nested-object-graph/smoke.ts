#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "041-memory-real-nested-object-graph",
  rowDir: "portability/nodejs/041-memory-real-nested-object-graph",
  kind: "machinen.nodejs-portability-memory-real-nested-object-graph-smoke-report",
  shape: "nested-object-graph",
  anchors: {
    anchor: "machinen-real-nested-anchor-v1",
    child: "nested-child:leaf",
    count: "nested-count:3",
  },
  semanticState: {
    kind: "nested-object-graph",
    anchor: "machinen-real-nested-anchor-v1",
    child: {
      label: "leaf",
      count: 3,
    },
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
