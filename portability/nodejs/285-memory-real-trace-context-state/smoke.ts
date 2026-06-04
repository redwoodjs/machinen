#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "285-memory-real-trace-context-state",
  rowDir: "portability/nodejs/285-memory-real-trace-context-state",
  kind: "machinen.nodejs-portability-memory-real-trace-context-state-smoke-report",
  shape: "trace-context-state",
  anchors: {
    anchor: "machinen-real-trace-context-state-anchor-v1",
    marker: "observability:trace-context-state:unsupported",
  },
  semanticState: {
    kind: "trace-context-state",
    anchor: "machinen-real-trace-context-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-trace-context-unsupported",
  refusalReason:
    "trace context state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
