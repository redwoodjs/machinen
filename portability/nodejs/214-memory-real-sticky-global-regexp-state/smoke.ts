#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "214-memory-real-sticky-global-regexp-state",
  rowDir: "portability/nodejs/214-memory-real-sticky-global-regexp-state",
  kind: "machinen.nodejs-portability-memory-real-sticky-global-regexp-state-smoke-report",
  shape: "sticky-global-regexp-state",
  anchors: {
    anchor: "machinen-real-sticky-global-regexp-state-anchor-v1",
    marker: "sticky-global-regexp-state:semantic-state",
  },
  semanticState: {
    kind: "sticky-global-regexp-state",
    anchor: "machinen-real-sticky-global-regexp-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
