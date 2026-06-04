#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "138-memory-real-once-listeners-state",
  rowDir: "portability/nodejs/138-memory-real-once-listeners-state",
  kind: "machinen.nodejs-portability-memory-real-once-listeners-state-smoke-report",
  shape: "once-listeners-state",
  anchors: {
    anchor: "machinen-real-once-listeners-state-anchor-v1",
    marker: "once-listeners-state:semantic-state",
  },
  semanticState: {
    kind: "once-listeners-state",
    anchor: "machinen-real-once-listeners-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
