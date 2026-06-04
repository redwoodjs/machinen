#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "169-memory-real-handler-registry-state",
  rowDir: "portability/nodejs/169-memory-real-handler-registry-state",
  kind: "machinen.nodejs-portability-memory-real-handler-registry-state-smoke-report",
  shape: "handler-registry-state",
  anchors: {
    anchor: "machinen-real-handler-registry-state-anchor-v1",
    marker: "handler-registry-state:semantic-state",
  },
  semanticState: {
    kind: "handler-registry-state",
    anchor: "machinen-real-handler-registry-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
