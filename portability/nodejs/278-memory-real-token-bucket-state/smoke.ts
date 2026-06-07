#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "278-memory-real-token-bucket-state",
  rowDir: "portability/nodejs/278-memory-real-token-bucket-state",
  kind: "machinen.nodejs-portability-memory-real-token-bucket-state-smoke-report",
  shape: "token-bucket-state",
  anchors: {
    anchor: "machinen-real-token-bucket-state-anchor-v1",
    marker: "token-bucket-state:semantic-state",
  },
  semanticState: {
    kind: "token-bucket-state",
    anchor: "machinen-real-token-bucket-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
