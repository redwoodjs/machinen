#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "098-memory-real-textencoder-state",
  rowDir: "portability/nodejs/098-memory-real-textencoder-state",
  kind: "machinen.nodejs-portability-memory-real-textencoder-state-smoke-report",
  shape: "textencoder-state",
  anchors: {
    anchor: "machinen-real-textencoder-state-anchor-v1",
    marker: "textencoder-state:semantic-state",
  },
  semanticState: {
    kind: "textencoder-state",
    anchor: "machinen-real-textencoder-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
