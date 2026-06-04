#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "157-memory-real-async-state-machine-refusal",
  rowDir: "portability/nodejs/157-memory-real-async-state-machine-refusal",
  kind: "machinen.nodejs-portability-memory-real-async-state-machine-refusal-smoke-report",
  shape: "async-state-machine",
  anchors: {
    anchor: "machinen-real-async-state-machine-refusal-anchor-v1",
    marker: "state-machine:async-state-machine-refusal:unsupported",
  },
  semanticState: {
    kind: "async-state-machine-refusal",
    anchor: "machinen-real-async-state-machine-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-async-state-machine-unsupported",
  refusalReason:
    "async state machine refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
