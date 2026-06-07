#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "135-memory-real-static-fields-state",
  rowDir: "portability/nodejs/135-memory-real-static-fields-state",
  kind: "machinen.nodejs-portability-memory-real-static-fields-state-smoke-report",
  shape: "static-fields-state",
  anchors: {
    anchor: "machinen-real-static-fields-state-anchor-v1",
    marker: "static-fields-state:semantic-state",
  },
  semanticState: {
    kind: "static-fields-state",
    anchor: "machinen-real-static-fields-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
