#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "298-memory-real-completed-ast-cache-state",
  rowDir: "portability/nodejs/298-memory-real-completed-ast-cache-state",
  kind: "machinen.nodejs-portability-memory-real-completed-ast-cache-state-smoke-report",
  shape: "completed-ast-cache-state",
  anchors: {
    anchor: "machinen-real-completed-ast-cache-state-anchor-v1",
    marker: "parser-state:completed-ast-cache-state:unsupported",
  },
  semanticState: {
    kind: "completed-ast-cache-state",
    anchor: "machinen-real-completed-ast-cache-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-completed-ast-cache-unsupported",
  refusalReason:
    "completed ast cache state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
