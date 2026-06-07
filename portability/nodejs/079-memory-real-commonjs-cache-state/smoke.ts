#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "079-memory-real-commonjs-cache-state",
  rowDir: "portability/nodejs/079-memory-real-commonjs-cache-state",
  kind: "machinen.nodejs-portability-memory-real-commonjs-cache-state-smoke-report",
  shape: "commonjs-cache-state",
  anchors: {
    anchor: "machinen-real-commonjs-cache-state-anchor-v1",
    marker: "commonjs-cache-state:semantic-state",
  },
  semanticState: {
    kind: "commonjs-cache-state",
    anchor: "machinen-real-commonjs-cache-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
