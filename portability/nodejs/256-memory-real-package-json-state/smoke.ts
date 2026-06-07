#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "256-memory-real-package-json-state",
  rowDir: "portability/nodejs/256-memory-real-package-json-state",
  kind: "machinen.nodejs-portability-memory-real-package-json-state-smoke-report",
  shape: "package-json-state",
  anchors: {
    anchor: "machinen-real-package-json-state-anchor-v1",
    marker: "package-json-state:semantic-state",
  },
  semanticState: {
    kind: "package-json-state",
    anchor: "machinen-real-package-json-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
