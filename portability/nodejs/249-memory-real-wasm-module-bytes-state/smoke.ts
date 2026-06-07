#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "249-memory-real-wasm-module-bytes-state",
  rowDir: "portability/nodejs/249-memory-real-wasm-module-bytes-state",
  kind: "machinen.nodejs-portability-memory-real-wasm-module-bytes-state-smoke-report",
  shape: "wasm-module-bytes-state",
  anchors: {
    anchor: "machinen-real-wasm-module-bytes-state-anchor-v1",
    marker: "wasm-module-bytes-state:semantic-state",
  },
  semanticState: {
    kind: "wasm-module-bytes-state",
    anchor: "machinen-real-wasm-module-bytes-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
