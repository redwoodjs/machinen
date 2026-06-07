#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "160-memory-real-immutable-config-object-state",
  rowDir: "portability/nodejs/160-memory-real-immutable-config-object-state",
  kind: "machinen.nodejs-portability-memory-real-immutable-config-object-state-smoke-report",
  shape: "immutable-config-object-state",
  anchors: {
    anchor: "machinen-real-immutable-config-object-state-anchor-v1",
    marker: "immutable-config-object-state:semantic-state",
  },
  semanticState: {
    kind: "immutable-config-object-state",
    anchor: "machinen-real-immutable-config-object-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
