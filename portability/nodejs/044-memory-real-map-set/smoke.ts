#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "044-memory-real-map-set",
  rowDir: "portability/nodejs/044-memory-real-map-set",
  kind: "machinen.nodejs-portability-memory-real-map-set-smoke-report",
  shape: "map-set",
  anchors: {
    anchor: "machinen-real-map-set-anchor-v1",
    map: "map-entry:answer=42",
    set: "set-entry:portable",
  },
  semanticState: {
    kind: "map-set",
    anchor: "machinen-real-map-set-anchor-v1",
    mapEntries: [["answer", 42]],
    setEntries: ["portable"],
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
