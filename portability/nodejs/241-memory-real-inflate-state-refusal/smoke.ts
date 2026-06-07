#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "241-memory-real-inflate-state-refusal",
  rowDir: "portability/nodejs/241-memory-real-inflate-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-inflate-state-refusal-smoke-report",
  shape: "inflate-state",
  anchors: {
    anchor: "machinen-real-inflate-state-refusal-anchor-v1",
    marker: "compression:inflate-state-refusal:unsupported",
  },
  semanticState: {
    kind: "inflate-state-refusal",
    anchor: "machinen-real-inflate-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-inflate-unsupported",
  refusalReason:
    "inflate state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
