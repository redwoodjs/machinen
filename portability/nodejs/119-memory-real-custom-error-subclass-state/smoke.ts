#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "119-memory-real-custom-error-subclass-state",
  rowDir: "portability/nodejs/119-memory-real-custom-error-subclass-state",
  kind: "machinen.nodejs-portability-memory-real-custom-error-subclass-state-smoke-report",
  shape: "custom-error-subclass-state",
  anchors: {
    anchor: "machinen-real-custom-error-subclass-state-anchor-v1",
    marker: "custom-error-subclass-state:semantic-state",
  },
  semanticState: {
    kind: "custom-error-subclass-state",
    anchor: "machinen-real-custom-error-subclass-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
