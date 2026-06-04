#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "293-memory-real-compiled-template-cache-state",
  rowDir: "portability/nodejs/293-memory-real-compiled-template-cache-state",
  kind: "machinen.nodejs-portability-memory-real-compiled-template-cache-state-smoke-report",
  shape: "compiled-template-cache-state",
  anchors: {
    anchor: "machinen-real-compiled-template-cache-state-anchor-v1",
    marker: "compiled-template-cache-state:semantic-state",
  },
  semanticState: {
    kind: "compiled-template-cache-state",
    anchor: "machinen-real-compiled-template-cache-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
