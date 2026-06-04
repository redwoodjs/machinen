#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "194-memory-real-rejected-promise-state",
  rowDir: "portability/nodejs/194-memory-real-rejected-promise-state",
  kind: "machinen.nodejs-portability-memory-real-rejected-promise-state-smoke-report",
  shape: "rejected-promise-state",
  anchors: {
    anchor: "machinen-real-rejected-promise-state-anchor-v1",
    marker: "promise-detail:rejected-promise-state:unsupported",
  },
  semanticState: {
    kind: "rejected-promise-state",
    anchor: "machinen-real-rejected-promise-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-rejected-promise-unsupported",
  refusalReason:
    "rejected promise state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
