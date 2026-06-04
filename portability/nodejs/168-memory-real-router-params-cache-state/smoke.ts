#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "168-memory-real-router-params-cache-state",
  rowDir: "portability/nodejs/168-memory-real-router-params-cache-state",
  kind: "machinen.nodejs-portability-memory-real-router-params-cache-state-smoke-report",
  shape: "router-params-cache-state",
  anchors: {
    anchor: "machinen-real-router-params-cache-state-anchor-v1",
    marker: "router-params-cache-state:semantic-state",
  },
  semanticState: {
    kind: "router-params-cache-state",
    anchor: "machinen-real-router-params-cache-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
