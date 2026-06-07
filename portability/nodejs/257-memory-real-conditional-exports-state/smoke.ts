#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "257-memory-real-conditional-exports-state",
  rowDir: "portability/nodejs/257-memory-real-conditional-exports-state",
  kind: "machinen.nodejs-portability-memory-real-conditional-exports-state-smoke-report",
  shape: "conditional-exports-state",
  anchors: {
    anchor: "machinen-real-conditional-exports-state-anchor-v1",
    marker: "conditional-exports-state:semantic-state",
  },
  semanticState: {
    kind: "conditional-exports-state",
    anchor: "machinen-real-conditional-exports-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
