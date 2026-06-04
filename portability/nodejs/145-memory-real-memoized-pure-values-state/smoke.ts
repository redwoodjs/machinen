#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "145-memory-real-memoized-pure-values-state",
  rowDir: "portability/nodejs/145-memory-real-memoized-pure-values-state",
  kind: "machinen.nodejs-portability-memory-real-memoized-pure-values-state-smoke-report",
  shape: "memoized-pure-values-state",
  anchors: {
    anchor: "machinen-real-memoized-pure-values-state-anchor-v1",
    marker: "cache-policy:memoized-pure-values-state:unsupported",
  },
  semanticState: {
    kind: "memoized-pure-values-state",
    anchor: "machinen-real-memoized-pure-values-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-memoized-pure-values-unsupported",
  refusalReason:
    "memoized pure values state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
