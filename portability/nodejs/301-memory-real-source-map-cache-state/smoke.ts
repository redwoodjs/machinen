#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "301-memory-real-source-map-cache-state",
  rowDir: "portability/nodejs/301-memory-real-source-map-cache-state",
  kind: "machinen.nodejs-portability-memory-real-source-map-cache-state-smoke-report",
  shape: "source-map-cache-state",
  anchors: {
    anchor: "machinen-real-source-map-cache-state-anchor-v1",
    marker: "source-map-cache-state:semantic-state",
  },
  semanticState: {
    kind: "source-map-cache-state",
    anchor: "machinen-real-source-map-cache-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
