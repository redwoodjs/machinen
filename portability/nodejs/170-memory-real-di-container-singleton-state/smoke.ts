#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "170-memory-real-di-container-singleton-state",
  rowDir: "portability/nodejs/170-memory-real-di-container-singleton-state",
  kind: "machinen.nodejs-portability-memory-real-di-container-singleton-state-smoke-report",
  shape: "di-container-singleton-state",
  anchors: {
    anchor: "machinen-real-di-container-singleton-state-anchor-v1",
    marker: "framework-state:di-container-singleton-state:unsupported",
  },
  semanticState: {
    kind: "di-container-singleton-state",
    anchor: "machinen-real-di-container-singleton-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-di-container-singleton-unsupported",
  refusalReason:
    "di container singleton state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
