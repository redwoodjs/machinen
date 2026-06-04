#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "269-memory-real-index-map-state",
  rowDir: "portability/nodejs/269-memory-real-index-map-state",
  kind: "machinen.nodejs-portability-memory-real-index-map-state-smoke-report",
  shape: "index-map-state",
  anchors: {
    anchor: "machinen-real-index-map-state-anchor-v1",
    marker: "in-memory-db:index-map-state:unsupported",
  },
  semanticState: {
    kind: "index-map-state",
    anchor: "machinen-real-index-map-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-index-map-unsupported",
  refusalReason:
    "index map state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
