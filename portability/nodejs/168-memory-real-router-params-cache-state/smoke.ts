#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "168-memory-real-router-params-cache-state",
  rowDir: "portability/nodejs/168-memory-real-router-params-cache-state",
  kind: "machinen.nodejs-portability-memory-real-router-params-cache-state-smoke-report",
  shape: "router-params-cache-state",
  anchors: {
    anchor: "machinen-real-router-params-cache-state-anchor-v1",
    marker: "framework-state:router-params-cache-state:unsupported",
  },
  semanticState: {
    kind: "router-params-cache-state",
    anchor: "machinen-real-router-params-cache-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-router-params-cache-unsupported",
  refusalReason:
    "router params cache state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
