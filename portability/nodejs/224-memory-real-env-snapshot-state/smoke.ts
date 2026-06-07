#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "224-memory-real-env-snapshot-state",
  rowDir: "portability/nodejs/224-memory-real-env-snapshot-state",
  kind: "machinen.nodejs-portability-memory-real-env-snapshot-state-smoke-report",
  shape: "env-snapshot-state",
  anchors: {
    anchor: "machinen-real-env-snapshot-state-anchor-v1",
    marker: "env-snapshot-state:semantic-state",
  },
  semanticState: {
    kind: "env-snapshot-state",
    anchor: "machinen-real-env-snapshot-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
