#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "204-memory-real-local-symbol-descriptor-state",
  rowDir: "portability/nodejs/204-memory-real-local-symbol-descriptor-state",
  kind: "machinen.nodejs-portability-memory-real-local-symbol-descriptor-state-smoke-report",
  shape: "local-symbol-descriptor-state",
  anchors: {
    anchor: "machinen-real-local-symbol-descriptor-state-anchor-v1",
    marker: "local-symbol-descriptor-state:semantic-state",
  },
  semanticState: {
    kind: "local-symbol-descriptor-state",
    anchor: "machinen-real-local-symbol-descriptor-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
