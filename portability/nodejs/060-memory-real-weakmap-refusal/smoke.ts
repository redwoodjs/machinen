#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "060-memory-real-weakmap-refusal",
  rowDir: "portability/nodejs/060-memory-real-weakmap-refusal",
  kind: "machinen.nodejs-portability-memory-real-weakmap-refusal-smoke-report",
  shape: "weakmap",
  anchors: {
    anchor: "machinen-real-weakmap-refusal-anchor-v1",
    weakmap: "weakmap:opaque-key-reachability",
  },
  semanticState: {
    kind: "weakmap",
    anchor: "machinen-real-weakmap-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-weakmap-unsupported",
  refusalReason:
    "WeakMap entries depend on opaque key reachability and are not portable semantic memory state",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
