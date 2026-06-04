#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "139-memory-real-symbol-event-name-state",
  rowDir: "portability/nodejs/139-memory-real-symbol-event-name-state",
  kind: "machinen.nodejs-portability-memory-real-symbol-event-name-state-smoke-report",
  shape: "symbol-event-name-state",
  anchors: {
    anchor: "machinen-real-symbol-event-name-state-anchor-v1",
    marker: "eventemitter-advanced:symbol-event-name-state:unsupported",
  },
  semanticState: {
    kind: "symbol-event-name-state",
    anchor: "machinen-real-symbol-event-name-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-symbol-event-name-unsupported",
  refusalReason:
    "symbol event name state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
