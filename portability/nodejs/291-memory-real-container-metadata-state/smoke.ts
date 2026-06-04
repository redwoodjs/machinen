#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "291-memory-real-container-metadata-state",
  rowDir: "portability/nodejs/291-memory-real-container-metadata-state",
  kind: "machinen.nodejs-portability-memory-real-container-metadata-state-smoke-report",
  shape: "container-metadata-state",
  anchors: {
    anchor: "machinen-real-container-metadata-state-anchor-v1",
    marker: "container-metadata-state:semantic-state",
  },
  semanticState: {
    kind: "container-metadata-state",
    anchor: "machinen-real-container-metadata-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
