#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "070-memory-real-property-descriptors-state",
  rowDir: "portability/nodejs/070-memory-real-property-descriptors-state",
  kind: "machinen.nodejs-portability-memory-real-property-descriptors-state-smoke-report",
  shape: "property-descriptors-state",
  anchors: {
    anchor: "machinen-real-property-descriptors-state-anchor-v1",
    marker: "property-descriptors-state:semantic-state",
  },
  semanticState: {
    kind: "property-descriptors-state",
    anchor: "machinen-real-property-descriptors-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
