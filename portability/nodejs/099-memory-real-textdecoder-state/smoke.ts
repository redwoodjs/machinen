#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "099-memory-real-textdecoder-state",
  rowDir: "portability/nodejs/099-memory-real-textdecoder-state",
  kind: "machinen.nodejs-portability-memory-real-textdecoder-state-smoke-report",
  shape: "textdecoder-state",
  anchors: {
    anchor: "machinen-real-textdecoder-state-anchor-v1",
    marker: "textdecoder-state:semantic-state",
  },
  semanticState: {
    kind: "textdecoder-state",
    anchor: "machinen-real-textdecoder-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
