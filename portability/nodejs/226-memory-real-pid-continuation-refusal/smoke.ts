#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "226-memory-real-pid-continuation-refusal",
  rowDir: "portability/nodejs/226-memory-real-pid-continuation-refusal",
  kind: "machinen.nodejs-portability-memory-real-pid-continuation-refusal-smoke-report",
  shape: "pid-continuation",
  anchors: {
    anchor: "machinen-real-pid-continuation-refusal-anchor-v1",
    marker: "process-object:pid-continuation-refusal:unsupported",
  },
  semanticState: {
    kind: "pid-continuation-refusal",
    anchor: "machinen-real-pid-continuation-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-pid-continuation-unsupported",
  refusalReason:
    "pid continuation refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
