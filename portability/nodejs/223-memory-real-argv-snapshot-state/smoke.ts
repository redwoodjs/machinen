#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "223-memory-real-argv-snapshot-state",
  rowDir: "portability/nodejs/223-memory-real-argv-snapshot-state",
  kind: "machinen.nodejs-portability-memory-real-argv-snapshot-state-smoke-report",
  shape: "argv-snapshot-state",
  anchors: {
    anchor: "machinen-real-argv-snapshot-state-anchor-v1",
    marker: "argv-snapshot-state:semantic-state",
  },
  semanticState: {
    kind: "argv-snapshot-state",
    anchor: "machinen-real-argv-snapshot-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
