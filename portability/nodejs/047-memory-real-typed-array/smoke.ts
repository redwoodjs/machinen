#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "047-memory-real-typed-array",
  rowDir: "portability/nodejs/047-memory-real-typed-array",
  kind: "machinen.nodejs-portability-memory-real-typed-array-smoke-report",
  shape: "typed-array",
  anchors: {
    anchor: "machinen-real-typed-array-anchor-v1",
    values: "typed-array-values:7,11,13",
  },
  semanticState: {
    kind: "typed-array",
    anchor: "machinen-real-typed-array-anchor-v1",
    constructor: "Uint32Array",
    values: [7, 11, 13],
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
