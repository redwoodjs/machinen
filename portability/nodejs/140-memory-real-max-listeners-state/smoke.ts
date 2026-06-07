#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "140-memory-real-max-listeners-state",
  rowDir: "portability/nodejs/140-memory-real-max-listeners-state",
  kind: "machinen.nodejs-portability-memory-real-max-listeners-state-smoke-report",
  shape: "max-listeners-state",
  anchors: {
    anchor: "machinen-real-max-listeners-state-anchor-v1",
    marker: "max-listeners-state:semantic-state",
  },
  semanticState: {
    kind: "max-listeners-state",
    anchor: "machinen-real-max-listeners-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
