#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "145-memory-real-memoized-pure-values-state",
  rowDir: "portability/nodejs/145-memory-real-memoized-pure-values-state",
  kind: "machinen.nodejs-portability-memory-real-memoized-pure-values-state-smoke-report",
  shape: "memoized-pure-values-state",
  anchors: {
    anchor: "machinen-real-memoized-pure-values-state-anchor-v1",
    marker: "memoized-pure-values-state:semantic-state",
  },
  semanticState: {
    kind: "memoized-pure-values-state",
    anchor: "machinen-real-memoized-pure-values-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
