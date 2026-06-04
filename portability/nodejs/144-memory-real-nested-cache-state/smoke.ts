#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "144-memory-real-nested-cache-state",
  rowDir: "portability/nodejs/144-memory-real-nested-cache-state",
  kind: "machinen.nodejs-portability-memory-real-nested-cache-state-smoke-report",
  shape: "nested-cache-state",
  anchors: {
    anchor: "machinen-real-nested-cache-state-anchor-v1",
    marker: "cache-policy:nested-cache-state:unsupported",
  },
  semanticState: {
    kind: "nested-cache-state",
    anchor: "machinen-real-nested-cache-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-nested-cache-unsupported",
  refusalReason:
    "nested cache state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
