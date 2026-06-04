#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "124-memory-real-shared-backing-store-state",
  rowDir: "portability/nodejs/124-memory-real-shared-backing-store-state",
  kind: "machinen.nodejs-portability-memory-real-shared-backing-store-state-smoke-report",
  shape: "shared-backing-store-state",
  anchors: {
    anchor: "machinen-real-shared-backing-store-state-anchor-v1",
    marker: "shared-backing-store-state:semantic-state",
  },
  semanticState: {
    kind: "shared-backing-store-state",
    anchor: "machinen-real-shared-backing-store-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
