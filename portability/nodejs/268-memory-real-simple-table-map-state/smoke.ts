#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "268-memory-real-simple-table-map-state",
  rowDir: "portability/nodejs/268-memory-real-simple-table-map-state",
  kind: "machinen.nodejs-portability-memory-real-simple-table-map-state-smoke-report",
  shape: "simple-table-map-state",
  anchors: {
    anchor: "machinen-real-simple-table-map-state-anchor-v1",
    marker: "in-memory-db:simple-table-map-state:unsupported",
  },
  semanticState: {
    kind: "simple-table-map-state",
    anchor: "machinen-real-simple-table-map-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-simple-table-map-unsupported",
  refusalReason:
    "simple table map state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
