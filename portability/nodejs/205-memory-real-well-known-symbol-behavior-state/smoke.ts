#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "205-memory-real-well-known-symbol-behavior-state",
  rowDir: "portability/nodejs/205-memory-real-well-known-symbol-behavior-state",
  kind: "machinen.nodejs-portability-memory-real-well-known-symbol-behavior-state-smoke-report",
  shape: "well-known-symbol-behavior-state",
  anchors: {
    anchor: "machinen-real-well-known-symbol-behavior-state-anchor-v1",
    marker: "well-known-symbol-behavior-state:semantic-state",
  },
  semanticState: {
    kind: "well-known-symbol-behavior-state",
    anchor: "machinen-real-well-known-symbol-behavior-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
