#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "219-memory-real-timezone-independent-state",
  rowDir: "portability/nodejs/219-memory-real-timezone-independent-state",
  kind: "machinen.nodejs-portability-memory-real-timezone-independent-state-smoke-report",
  shape: "timezone-independent-state",
  anchors: {
    anchor: "machinen-real-timezone-independent-state-anchor-v1",
    marker: "date-time:timezone-independent-state:unsupported",
  },
  semanticState: {
    kind: "timezone-independent-state",
    anchor: "machinen-real-timezone-independent-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-timezone-independent-unsupported",
  refusalReason:
    "timezone independent state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
