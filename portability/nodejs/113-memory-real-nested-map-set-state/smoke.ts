#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "113-memory-real-nested-map-set-state",
  rowDir: "portability/nodejs/113-memory-real-nested-map-set-state",
  kind: "machinen.nodejs-portability-memory-real-nested-map-set-state-smoke-report",
  shape: "nested-map-set-state",
  anchors: {
    anchor: "machinen-real-nested-map-set-state-anchor-v1",
    marker: "collections-advanced:nested-map-set-state:unsupported",
  },
  semanticState: {
    kind: "nested-map-set-state",
    anchor: "machinen-real-nested-map-set-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-nested-map-set-unsupported",
  refusalReason:
    "nested map set state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
