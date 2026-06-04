#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "224-memory-real-env-snapshot-state",
  rowDir: "portability/nodejs/224-memory-real-env-snapshot-state",
  kind: "machinen.nodejs-portability-memory-real-env-snapshot-state-smoke-report",
  shape: "env-snapshot-state",
  anchors: {
    anchor: "machinen-real-env-snapshot-state-anchor-v1",
    marker: "process-object:env-snapshot-state:unsupported",
  },
  semanticState: {
    kind: "env-snapshot-state",
    anchor: "machinen-real-env-snapshot-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-env-snapshot-unsupported",
  refusalReason:
    "env snapshot state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
