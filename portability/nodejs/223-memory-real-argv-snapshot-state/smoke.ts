#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "223-memory-real-argv-snapshot-state",
  rowDir: "portability/nodejs/223-memory-real-argv-snapshot-state",
  kind: "machinen.nodejs-portability-memory-real-argv-snapshot-state-smoke-report",
  shape: "argv-snapshot-state",
  anchors: {
    anchor: "machinen-real-argv-snapshot-state-anchor-v1",
    marker: "process-object:argv-snapshot-state:unsupported",
  },
  semanticState: {
    kind: "argv-snapshot-state",
    anchor: "machinen-real-argv-snapshot-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-argv-snapshot-unsupported",
  refusalReason:
    "argv snapshot state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
