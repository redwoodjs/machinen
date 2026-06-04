#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "100-memory-real-blob-state",
  rowDir: "portability/nodejs/100-memory-real-blob-state",
  kind: "machinen.nodejs-portability-memory-real-blob-state-smoke-report",
  shape: "blob-state",
  anchors: {
    anchor: "machinen-real-blob-state-anchor-v1",
    marker: "blob-state:semantic-state",
  },
  semanticState: {
    kind: "blob-state",
    anchor: "machinen-real-blob-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
