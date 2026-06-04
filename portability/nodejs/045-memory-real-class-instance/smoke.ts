#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "045-memory-real-class-instance",
  rowDir: "portability/nodejs/045-memory-real-class-instance",
  kind: "machinen.nodejs-portability-memory-real-class-instance-smoke-report",
  shape: "class-instance",
  anchors: {
    anchor: "machinen-real-class-anchor-v1",
    name: "class-name:Counter",
    count: "class-count:9",
  },
  semanticState: {
    kind: "class-instance",
    anchor: "machinen-real-class-anchor-v1",
    className: "Counter",
    count: 9,
    methodResult: 10,
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
