#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "123-memory-real-sliced-buffer-state",
  rowDir: "portability/nodejs/123-memory-real-sliced-buffer-state",
  kind: "machinen.nodejs-portability-memory-real-sliced-buffer-state-smoke-report",
  shape: "sliced-buffer-state",
  anchors: {
    anchor: "machinen-real-sliced-buffer-state-anchor-v1",
    marker: "sliced-buffer-state:semantic-state",
  },
  semanticState: {
    kind: "sliced-buffer-state",
    anchor: "machinen-real-sliced-buffer-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
