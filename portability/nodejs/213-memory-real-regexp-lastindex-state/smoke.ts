#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "213-memory-real-regexp-lastindex-state",
  rowDir: "portability/nodejs/213-memory-real-regexp-lastindex-state",
  kind: "machinen.nodejs-portability-memory-real-regexp-lastindex-state-smoke-report",
  shape: "regexp-lastindex-state",
  anchors: {
    anchor: "machinen-real-regexp-lastindex-state-anchor-v1",
    marker: "regexp-lastindex-state:semantic-state",
  },
  semanticState: {
    kind: "regexp-lastindex-state",
    anchor: "machinen-real-regexp-lastindex-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
