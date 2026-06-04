#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "063-memory-real-abort-controller-state",
  rowDir: "portability/nodejs/063-memory-real-abort-controller-state",
  kind: "machinen.nodejs-portability-memory-real-abort-controller-state-smoke-report",
  shape: "abort-controller-state",
  anchors: {
    anchor: "machinen-real-abort-controller-state-anchor-v1",
    marker: "async-context:abort-controller-state:unsupported",
  },
  semanticState: {
    kind: "abort-controller-state",
    anchor: "machinen-real-abort-controller-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-abort-controller-unsupported",
  refusalReason:
    "abort controller state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
