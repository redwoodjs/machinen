#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "288-memory-real-singleton-registry-state",
  rowDir: "portability/nodejs/288-memory-real-singleton-registry-state",
  kind: "machinen.nodejs-portability-memory-real-singleton-registry-state-smoke-report",
  shape: "singleton-registry-state",
  anchors: {
    anchor: "machinen-real-singleton-registry-state-anchor-v1",
    marker: "singleton-registry-state:semantic-state",
  },
  semanticState: {
    kind: "singleton-registry-state",
    anchor: "machinen-real-singleton-registry-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
