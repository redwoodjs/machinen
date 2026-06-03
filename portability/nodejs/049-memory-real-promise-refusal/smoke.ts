#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "049-memory-real-promise-refusal",
  rowDir: "portability/nodejs/049-memory-real-promise-refusal",
  kind: "machinen.nodejs-portability-memory-real-promise-refusal-smoke-report",
  shape: "pending-promise",
  anchors: {
    anchor: "machinen-real-promise-refusal-anchor-v1",
    promise: "pending-promise:unresolved",
  },
  semanticState: {
    kind: "pending-promise",
    anchor: "machinen-real-promise-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-pending-promise-unsupported",
  refusalReason: "pending Promise and microtask queue state is not portable semantic memory state",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
