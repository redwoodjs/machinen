#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "158-memory-real-env-derived-config-state",
  rowDir: "portability/nodejs/158-memory-real-env-derived-config-state",
  kind: "machinen.nodejs-portability-memory-real-env-derived-config-state-smoke-report",
  shape: "env-derived-config-state",
  anchors: {
    anchor: "machinen-real-env-derived-config-state-anchor-v1",
    marker: "env-derived-config-state:semantic-state",
  },
  semanticState: {
    kind: "env-derived-config-state",
    anchor: "machinen-real-env-derived-config-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
