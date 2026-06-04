#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "199-memory-real-structuredclone-compatible-graph-state",
  rowDir: "portability/nodejs/199-memory-real-structuredclone-compatible-graph-state",
  kind: "machinen.nodejs-portability-memory-real-structuredclone-compatible-graph-state-smoke-report",
  shape: "structuredclone-compatible-graph-state",
  anchors: {
    anchor: "machinen-real-structuredclone-compatible-graph-state-anchor-v1",
    marker: "serialization:structuredclone-compatible-graph-state:unsupported",
  },
  semanticState: {
    kind: "structuredclone-compatible-graph-state",
    anchor: "machinen-real-structuredclone-compatible-graph-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-structuredclone-compatible-graph-unsupported",
  refusalReason:
    "structuredclone compatible graph state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
