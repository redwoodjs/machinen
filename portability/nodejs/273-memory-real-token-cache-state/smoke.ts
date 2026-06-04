#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "273-memory-real-token-cache-state",
  rowDir: "portability/nodejs/273-memory-real-token-cache-state",
  kind: "machinen.nodejs-portability-memory-real-token-cache-state-smoke-report",
  shape: "token-cache-state",
  anchors: {
    anchor: "machinen-real-token-cache-state-anchor-v1",
    marker: "token-cache-state:semantic-state",
  },
  semanticState: {
    kind: "token-cache-state",
    anchor: "machinen-real-token-cache-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
