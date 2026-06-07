#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "207-memory-real-symbol-toStringTag-state",
  rowDir: "portability/nodejs/207-memory-real-symbol-toStringTag-state",
  kind: "machinen.nodejs-portability-memory-real-symbol-toStringTag-state-smoke-report",
  shape: "symbol-toStringTag-state",
  anchors: {
    anchor: "machinen-real-symbol-toStringTag-state-anchor-v1",
    marker: "symbol-toStringTag-state:semantic-state",
  },
  semanticState: {
    kind: "symbol-toStringTag-state",
    anchor: "machinen-real-symbol-toStringTag-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
