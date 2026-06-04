#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "169-memory-real-handler-registry-state",
  rowDir: "portability/nodejs/169-memory-real-handler-registry-state",
  kind: "machinen.nodejs-portability-memory-real-handler-registry-state-smoke-report",
  shape: "handler-registry-state",
  anchors: {
    anchor: "machinen-real-handler-registry-state-anchor-v1",
    marker: "framework-state:handler-registry-state:unsupported",
  },
  semanticState: {
    kind: "handler-registry-state",
    anchor: "machinen-real-handler-registry-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-handler-registry-unsupported",
  refusalReason:
    "handler registry state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
