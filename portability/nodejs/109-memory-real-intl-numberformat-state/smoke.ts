#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "109-memory-real-intl-numberformat-state",
  rowDir: "portability/nodejs/109-memory-real-intl-numberformat-state",
  kind: "machinen.nodejs-portability-memory-real-intl-numberformat-state-smoke-report",
  shape: "intl-numberformat-state",
  anchors: {
    anchor: "machinen-real-intl-numberformat-state-anchor-v1",
    marker: "intl-numberformat-state:semantic-state",
  },
  semanticState: {
    kind: "intl-numberformat-state",
    anchor: "machinen-real-intl-numberformat-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
