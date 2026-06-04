#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "163-memory-real-route-table-state",
  rowDir: "portability/nodejs/163-memory-real-route-table-state",
  kind: "machinen.nodejs-portability-memory-real-route-table-state-smoke-report",
  shape: "route-table-state",
  anchors: {
    anchor: "machinen-real-route-table-state-anchor-v1",
    marker: "http-app-state:route-table-state:unsupported",
  },
  semanticState: {
    kind: "route-table-state",
    anchor: "machinen-real-route-table-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-route-table-unsupported",
  refusalReason:
    "route table state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
