#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "111-memory-real-intl-locale-state",
  rowDir: "portability/nodejs/111-memory-real-intl-locale-state",
  kind: "machinen.nodejs-portability-memory-real-intl-locale-state-smoke-report",
  shape: "intl-locale-state",
  anchors: {
    anchor: "machinen-real-intl-locale-state-anchor-v1",
    marker: "intl-locale-state:semantic-state",
  },
  semanticState: {
    kind: "intl-locale-state",
    anchor: "machinen-real-intl-locale-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
