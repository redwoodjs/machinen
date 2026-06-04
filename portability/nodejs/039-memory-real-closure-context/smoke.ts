#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "039-memory-real-closure-context",
  rowDir: "portability/nodejs/039-memory-real-closure-context",
  kind: "machinen.nodejs-portability-memory-real-closure-context-smoke-report",
  shape: "closure-context",
  anchors: {
    anchor: "machinen-real-closure-anchor-v1",
    count: "closure-count:12",
  },
  semanticState: {
    kind: "closure-context",
    anchor: "machinen-real-closure-anchor-v1",
    count: 12,
    next: 13,
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
