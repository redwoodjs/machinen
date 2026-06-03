#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "038-memory-real-array",
  rowDir: "portability/nodejs/038-memory-real-array",
  kind: "machinen.nodejs-portability-memory-real-array-smoke-report",
  shape: "array",
  anchors: {
    anchor: "machinen-real-array-anchor-v1",
    values: "array-values:1,2,3,5,8",
  },
  semanticState: {
    kind: "array",
    anchor: "machinen-real-array-anchor-v1",
    values: [1, 2, 3, 5, 8],
    sum: 19,
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
