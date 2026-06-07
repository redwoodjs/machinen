#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "101-memory-real-filelike-buffer-state",
  rowDir: "portability/nodejs/101-memory-real-filelike-buffer-state",
  kind: "machinen.nodejs-portability-memory-real-filelike-buffer-state-smoke-report",
  shape: "filelike-buffer-state",
  anchors: {
    anchor: "machinen-real-filelike-buffer-state-anchor-v1",
    marker: "filelike-buffer-state:semantic-state",
  },
  semanticState: {
    kind: "filelike-buffer-state",
    anchor: "machinen-real-filelike-buffer-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
