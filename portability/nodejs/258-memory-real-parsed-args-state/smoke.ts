#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "258-memory-real-parsed-args-state",
  rowDir: "portability/nodejs/258-memory-real-parsed-args-state",
  kind: "machinen.nodejs-portability-memory-real-parsed-args-state-smoke-report",
  shape: "parsed-args-state",
  anchors: {
    anchor: "machinen-real-parsed-args-state-anchor-v1",
    marker: "parsed-args-state:semantic-state",
  },
  semanticState: {
    kind: "parsed-args-state",
    anchor: "machinen-real-parsed-args-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
