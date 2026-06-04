#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "070-memory-real-property-descriptors-state",
  rowDir: "portability/nodejs/070-memory-real-property-descriptors-state",
  kind: "machinen.nodejs-portability-memory-real-property-descriptors-state-smoke-report",
  shape: "property-descriptors-state",
  anchors: {
    anchor: "machinen-real-property-descriptors-state-anchor-v1",
    marker: "object-mechanics:property-descriptors-state:unsupported",
  },
  semanticState: {
    kind: "property-descriptors-state",
    anchor: "machinen-real-property-descriptors-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-property-descriptors-unsupported",
  refusalReason:
    "property descriptors state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
