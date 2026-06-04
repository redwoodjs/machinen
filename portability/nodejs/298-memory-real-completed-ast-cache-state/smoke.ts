#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "298-memory-real-completed-ast-cache-state",
  rowDir: "portability/nodejs/298-memory-real-completed-ast-cache-state",
  kind: "machinen.nodejs-portability-memory-real-completed-ast-cache-state-smoke-report",
  shape: "completed-ast-cache-state",
  anchors: {
    anchor: "machinen-real-completed-ast-cache-state-anchor-v1",
    marker: "completed-ast-cache-state:semantic-state",
  },
  semanticState: {
    kind: "completed-ast-cache-state",
    anchor: "machinen-real-completed-ast-cache-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
