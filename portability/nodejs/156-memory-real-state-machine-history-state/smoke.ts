#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "156-memory-real-state-machine-history-state",
  rowDir: "portability/nodejs/156-memory-real-state-machine-history-state",
  kind: "machinen.nodejs-portability-memory-real-state-machine-history-state-smoke-report",
  shape: "state-machine-history-state",
  anchors: {
    anchor: "machinen-real-state-machine-history-state-anchor-v1",
    marker: "state-machine:state-machine-history-state:unsupported",
  },
  semanticState: {
    kind: "state-machine-history-state",
    anchor: "machinen-real-state-machine-history-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-state-machine-history-unsupported",
  refusalReason:
    "state machine history state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
