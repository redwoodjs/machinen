#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "149-memory-real-deque-state",
  rowDir: "portability/nodejs/149-memory-real-deque-state",
  kind: "machinen.nodejs-portability-memory-real-deque-state-smoke-report",
  shape: "deque-state",
  anchors: {
    anchor: "machinen-real-deque-state-anchor-v1",
    marker: "queue-policy:deque-state:unsupported",
  },
  semanticState: {
    kind: "deque-state",
    anchor: "machinen-real-deque-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-deque-unsupported",
  refusalReason:
    "deque state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
