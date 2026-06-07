#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "254-memory-real-require-resolve-cache-state",
  rowDir: "portability/nodejs/254-memory-real-require-resolve-cache-state",
  kind: "machinen.nodejs-portability-memory-real-require-resolve-cache-state-smoke-report",
  shape: "require-resolve-cache-state",
  anchors: {
    anchor: "machinen-real-require-resolve-cache-state-anchor-v1",
    marker: "require-resolve-cache-state:semantic-state",
  },
  semanticState: {
    kind: "require-resolve-cache-state",
    anchor: "machinen-real-require-resolve-cache-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
