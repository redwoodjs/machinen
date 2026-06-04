#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "110-memory-real-intl-collator-state",
  rowDir: "portability/nodejs/110-memory-real-intl-collator-state",
  kind: "machinen.nodejs-portability-memory-real-intl-collator-state-smoke-report",
  shape: "intl-collator-state",
  anchors: {
    anchor: "machinen-real-intl-collator-state-anchor-v1",
    marker: "intl-collator-state:semantic-state",
  },
  semanticState: {
    kind: "intl-collator-state",
    anchor: "machinen-real-intl-collator-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
