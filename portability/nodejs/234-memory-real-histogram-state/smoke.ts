#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "234-memory-real-histogram-state",
  rowDir: "portability/nodejs/234-memory-real-histogram-state",
  kind: "machinen.nodejs-portability-memory-real-histogram-state-smoke-report",
  shape: "histogram-state",
  anchors: {
    anchor: "machinen-real-histogram-state-anchor-v1",
    marker: "diagnostics:histogram-state:unsupported",
  },
  semanticState: {
    kind: "histogram-state",
    anchor: "machinen-real-histogram-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-histogram-unsupported",
  refusalReason:
    "histogram state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
