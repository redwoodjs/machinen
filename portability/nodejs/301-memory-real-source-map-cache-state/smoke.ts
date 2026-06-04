#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "301-memory-real-source-map-cache-state",
  rowDir: "portability/nodejs/301-memory-real-source-map-cache-state",
  kind: "machinen.nodejs-portability-memory-real-source-map-cache-state-smoke-report",
  shape: "source-map-cache-state",
  anchors: {
    anchor: "machinen-real-source-map-cache-state-anchor-v1",
    marker: "parser-state:source-map-cache-state:unsupported",
  },
  semanticState: {
    kind: "source-map-cache-state",
    anchor: "machinen-real-source-map-cache-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-source-map-cache-unsupported",
  refusalReason:
    "source map cache state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
