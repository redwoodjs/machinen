#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "153-memory-real-enum-state-machine-state",
  rowDir: "portability/nodejs/153-memory-real-enum-state-machine-state",
  kind: "machinen.nodejs-portability-memory-real-enum-state-machine-state-smoke-report",
  shape: "enum-state-machine-state",
  anchors: {
    anchor: "machinen-real-enum-state-machine-state-anchor-v1",
    marker: "state-machine:enum-state-machine-state:unsupported",
  },
  semanticState: {
    kind: "enum-state-machine-state",
    anchor: "machinen-real-enum-state-machine-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-enum-state-machine-unsupported",
  refusalReason:
    "enum state machine state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
