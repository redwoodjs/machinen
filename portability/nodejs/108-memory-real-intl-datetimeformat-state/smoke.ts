#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "108-memory-real-intl-datetimeformat-state",
  rowDir: "portability/nodejs/108-memory-real-intl-datetimeformat-state",
  kind: "machinen.nodejs-portability-memory-real-intl-datetimeformat-state-smoke-report",
  shape: "intl-datetimeformat-state",
  anchors: {
    anchor: "machinen-real-intl-datetimeformat-state-anchor-v1",
    marker: "intl-datetimeformat-state:semantic-state",
  },
  semanticState: {
    kind: "intl-datetimeformat-state",
    anchor: "machinen-real-intl-datetimeformat-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
