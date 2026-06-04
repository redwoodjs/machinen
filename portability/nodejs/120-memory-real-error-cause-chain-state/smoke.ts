#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "120-memory-real-error-cause-chain-state",
  rowDir: "portability/nodejs/120-memory-real-error-cause-chain-state",
  kind: "machinen.nodejs-portability-memory-real-error-cause-chain-state-smoke-report",
  shape: "error-cause-chain-state",
  anchors: {
    anchor: "machinen-real-error-cause-chain-state-anchor-v1",
    marker: "error-cause-chain-state:semantic-state",
  },
  semanticState: {
    kind: "error-cause-chain-state",
    anchor: "machinen-real-error-cause-chain-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
