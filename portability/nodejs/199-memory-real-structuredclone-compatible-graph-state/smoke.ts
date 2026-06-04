#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "199-memory-real-structuredclone-compatible-graph-state",
  rowDir: "portability/nodejs/199-memory-real-structuredclone-compatible-graph-state",
  kind: "machinen.nodejs-portability-memory-real-structuredclone-compatible-graph-state-smoke-report",
  shape: "structuredclone-compatible-graph-state",
  anchors: {
    anchor: "machinen-real-structuredclone-compatible-graph-state-anchor-v1",
    marker: "structuredclone-compatible-graph-state:semantic-state",
  },
  semanticState: {
    kind: "structuredclone-compatible-graph-state",
    anchor: "machinen-real-structuredclone-compatible-graph-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
