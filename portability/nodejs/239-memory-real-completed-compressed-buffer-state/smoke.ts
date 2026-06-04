#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "239-memory-real-completed-compressed-buffer-state",
  rowDir: "portability/nodejs/239-memory-real-completed-compressed-buffer-state",
  kind: "machinen.nodejs-portability-memory-real-completed-compressed-buffer-state-smoke-report",
  shape: "completed-compressed-buffer-state",
  anchors: {
    anchor: "machinen-real-completed-compressed-buffer-state-anchor-v1",
    marker: "compression:completed-compressed-buffer-state:unsupported",
  },
  semanticState: {
    kind: "completed-compressed-buffer-state",
    anchor: "machinen-real-completed-compressed-buffer-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-completed-compressed-buffer-unsupported",
  refusalReason:
    "completed compressed buffer state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
