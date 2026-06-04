#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "225-memory-real-cwd-policy-state",
  rowDir: "portability/nodejs/225-memory-real-cwd-policy-state",
  kind: "machinen.nodejs-portability-memory-real-cwd-policy-state-smoke-report",
  shape: "cwd-policy-state",
  anchors: {
    anchor: "machinen-real-cwd-policy-state-anchor-v1",
    marker: "process-object:cwd-policy-state:unsupported",
  },
  semanticState: {
    kind: "cwd-policy-state",
    anchor: "machinen-real-cwd-policy-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-cwd-policy-unsupported",
  refusalReason:
    "cwd policy state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
