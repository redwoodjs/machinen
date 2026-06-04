#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "215-memory-real-unicode-regexp-state",
  rowDir: "portability/nodejs/215-memory-real-unicode-regexp-state",
  kind: "machinen.nodejs-portability-memory-real-unicode-regexp-state-smoke-report",
  shape: "unicode-regexp-state",
  anchors: {
    anchor: "machinen-real-unicode-regexp-state-anchor-v1",
    marker: "unicode-regexp-state:semantic-state",
  },
  semanticState: {
    kind: "unicode-regexp-state",
    anchor: "machinen-real-unicode-regexp-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
