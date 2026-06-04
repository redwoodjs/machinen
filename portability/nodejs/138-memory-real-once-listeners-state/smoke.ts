#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "138-memory-real-once-listeners-state",
  rowDir: "portability/nodejs/138-memory-real-once-listeners-state",
  kind: "machinen.nodejs-portability-memory-real-once-listeners-state-smoke-report",
  shape: "once-listeners-state",
  anchors: {
    anchor: "machinen-real-once-listeners-state-anchor-v1",
    marker: "eventemitter-advanced:once-listeners-state:unsupported",
  },
  semanticState: {
    kind: "once-listeners-state",
    anchor: "machinen-real-once-listeners-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-once-listeners-unsupported",
  refusalReason:
    "once listeners state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
