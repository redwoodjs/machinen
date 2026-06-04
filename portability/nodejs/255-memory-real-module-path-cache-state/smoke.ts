#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "255-memory-real-module-path-cache-state",
  rowDir: "portability/nodejs/255-memory-real-module-path-cache-state",
  kind: "machinen.nodejs-portability-memory-real-module-path-cache-state-smoke-report",
  shape: "module-path-cache-state",
  anchors: {
    anchor: "machinen-real-module-path-cache-state-anchor-v1",
    marker: "module-path-cache-state:semantic-state",
  },
  semanticState: {
    kind: "module-path-cache-state",
    anchor: "machinen-real-module-path-cache-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
