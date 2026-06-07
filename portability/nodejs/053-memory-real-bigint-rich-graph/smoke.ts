#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "053-memory-real-bigint-rich-graph",
  rowDir: "portability/nodejs/053-memory-real-bigint-rich-graph",
  kind: "machinen.nodejs-portability-memory-real-bigint-rich-graph-smoke-report",
  shape: "bigint-rich-graph",
  anchors: {
    anchor: "machinen-real-bigint-rich-graph-anchor-v1",
    primary: "bigint-primary:900719925474099312345",
    nested: "bigint-nested:18446744073709551615",
    array: "bigint-array:1,2,340282366920938463463374607431768211455",
  },
  semanticState: {
    kind: "bigint-rich-graph",
    anchor: "machinen-real-bigint-rich-graph-anchor-v1",
    label: "machinen-bigint-rich-graph-label-v1",
    primary: { type: "BigInt", decimal: "900719925474099312345" },
    nested: { amount: { type: "BigInt", decimal: "18446744073709551615" } },
    values: [
      { type: "BigInt", decimal: "1" },
      { type: "BigInt", decimal: "2" },
      { type: "BigInt", decimal: "340282366920938463463374607431768211455" },
    ],
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
