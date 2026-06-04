#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "300-memory-real-token-buffer-state",
  rowDir: "portability/nodejs/300-memory-real-token-buffer-state",
  kind: "machinen.nodejs-portability-memory-real-token-buffer-state-smoke-report",
  shape: "token-buffer-state",
  anchors: {
    anchor: "machinen-real-token-buffer-state-anchor-v1",
    marker: "token-buffer-state:semantic-state",
  },
  semanticState: {
    kind: "token-buffer-state",
    anchor: "machinen-real-token-buffer-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
