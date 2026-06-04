#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "227-memory-real-process-title-state",
  rowDir: "portability/nodejs/227-memory-real-process-title-state",
  kind: "machinen.nodejs-portability-memory-real-process-title-state-smoke-report",
  shape: "process-title-state",
  anchors: {
    anchor: "machinen-real-process-title-state-anchor-v1",
    marker: "process-object:process-title-state:unsupported",
  },
  semanticState: {
    kind: "process-title-state",
    anchor: "machinen-real-process-title-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-process-title-unsupported",
  refusalReason:
    "process title state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
