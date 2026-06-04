#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "069-memory-real-reflect-metadata-state",
  rowDir: "portability/nodejs/069-memory-real-reflect-metadata-state",
  kind: "machinen.nodejs-portability-memory-real-reflect-metadata-state-smoke-report",
  shape: "reflect-metadata-state",
  anchors: {
    anchor: "machinen-real-reflect-metadata-state-anchor-v1",
    marker: "object-mechanics:reflect-metadata-state:unsupported",
  },
  semanticState: {
    kind: "reflect-metadata-state",
    anchor: "machinen-real-reflect-metadata-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-reflect-metadata-unsupported",
  refusalReason:
    "reflect metadata state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
