#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "055-memory-real-arraybuffer-dataview",
  rowDir: "portability/nodejs/055-memory-real-arraybuffer-dataview",
  kind: "machinen.nodejs-portability-memory-real-arraybuffer-dataview-smoke-report",
  shape: "arraybuffer-dataview",
  anchors: {
    anchor: "machinen-real-arraybuffer-dataview-anchor-v1",
    bytes: "arraybuffer-bytes:3,1,4,1,5,9,2,6",
    uint16: "dataview-uint16be:769",
    float32: "dataview-float32:3.5",
  },
  semanticState: {
    kind: "arraybuffer-dataview",
    anchor: "machinen-real-arraybuffer-dataview-anchor-v1",
    byteLength: 8,
    bytes: [3, 1, 4, 1, 5, 9, 2, 6],
    uint16beAt0: 769,
    float32leAt0: 3.5,
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
