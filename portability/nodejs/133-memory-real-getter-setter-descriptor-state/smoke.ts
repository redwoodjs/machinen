#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "133-memory-real-getter-setter-descriptor-state",
  rowDir: "portability/nodejs/133-memory-real-getter-setter-descriptor-state",
  kind: "machinen.nodejs-portability-memory-real-getter-setter-descriptor-state-smoke-report",
  shape: "getter-setter-descriptor-state",
  anchors: {
    anchor: "machinen-real-getter-setter-descriptor-state-anchor-v1",
    marker: "getter-setter-descriptor-state:semantic-state",
  },
  semanticState: {
    kind: "getter-setter-descriptor-state",
    anchor: "machinen-real-getter-setter-descriptor-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
