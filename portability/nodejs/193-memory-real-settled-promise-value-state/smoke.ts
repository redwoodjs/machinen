#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "193-memory-real-settled-promise-value-state",
  rowDir: "portability/nodejs/193-memory-real-settled-promise-value-state",
  kind: "machinen.nodejs-portability-memory-real-settled-promise-value-state-smoke-report",
  shape: "settled-promise-value-state",
  anchors: {
    anchor: "machinen-real-settled-promise-value-state-anchor-v1",
    marker: "settled-promise-value-state:semantic-state",
  },
  semanticState: {
    kind: "settled-promise-value-state",
    anchor: "machinen-real-settled-promise-value-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
