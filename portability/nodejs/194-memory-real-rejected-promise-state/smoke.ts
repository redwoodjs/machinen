#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "194-memory-real-rejected-promise-state",
  rowDir: "portability/nodejs/194-memory-real-rejected-promise-state",
  kind: "machinen.nodejs-portability-memory-real-rejected-promise-state-smoke-report",
  shape: "rejected-promise-state",
  anchors: {
    anchor: "machinen-real-rejected-promise-state-anchor-v1",
    marker: "rejected-promise-state:semantic-state",
  },
  semanticState: {
    kind: "rejected-promise-state",
    anchor: "machinen-real-rejected-promise-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
