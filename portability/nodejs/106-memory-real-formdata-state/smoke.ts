#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "106-memory-real-formdata-state",
  rowDir: "portability/nodejs/106-memory-real-formdata-state",
  kind: "machinen.nodejs-portability-memory-real-formdata-state-smoke-report",
  shape: "formdata-state",
  anchors: {
    anchor: "machinen-real-formdata-state-anchor-v1",
    marker: "formdata-state:semantic-state",
  },
  semanticState: {
    kind: "formdata-state",
    anchor: "machinen-real-formdata-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
