#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "304-memory-real-redaction-policy-state",
  rowDir: "portability/nodejs/304-memory-real-redaction-policy-state",
  kind: "machinen.nodejs-portability-memory-real-redaction-policy-state-smoke-report",
  shape: "redaction-policy-state",
  anchors: {
    anchor: "machinen-real-redaction-policy-state-anchor-v1",
    marker: "redaction-policy-state:semantic-state",
  },
  semanticState: {
    kind: "redaction-policy-state",
    anchor: "machinen-real-redaction-policy-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
