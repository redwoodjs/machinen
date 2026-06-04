#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "149-memory-real-deque-state",
  rowDir: "portability/nodejs/149-memory-real-deque-state",
  kind: "machinen.nodejs-portability-memory-real-deque-state-smoke-report",
  shape: "deque-state",
  anchors: {
    anchor: "machinen-real-deque-state-anchor-v1",
    marker: "deque-state:semantic-state",
  },
  semanticState: {
    kind: "deque-state",
    anchor: "machinen-real-deque-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
