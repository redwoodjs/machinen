#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "259-memory-real-command-registry-state",
  rowDir: "portability/nodejs/259-memory-real-command-registry-state",
  kind: "machinen.nodejs-portability-memory-real-command-registry-state-smoke-report",
  shape: "command-registry-state",
  anchors: {
    anchor: "machinen-real-command-registry-state-anchor-v1",
    marker: "command-registry-state:semantic-state",
  },
  semanticState: {
    kind: "command-registry-state",
    anchor: "machinen-real-command-registry-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
