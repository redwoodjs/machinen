#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "069-memory-real-reflect-metadata-state",
  rowDir: "portability/nodejs/069-memory-real-reflect-metadata-state",
  kind: "machinen.nodejs-portability-memory-real-reflect-metadata-state-smoke-report",
  shape: "reflect-metadata-state",
  anchors: {
    anchor: "machinen-real-reflect-metadata-state-anchor-v1",
    marker: "reflect-metadata-state:semantic-state",
  },
  semanticState: {
    kind: "reflect-metadata-state",
    anchor: "machinen-real-reflect-metadata-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
