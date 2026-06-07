#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "066-memory-real-async-hooks-resource-refusal",
  rowDir: "portability/nodejs/066-memory-real-async-hooks-resource-refusal",
  kind: "machinen.nodejs-portability-memory-real-async-hooks-resource-refusal-smoke-report",
  shape: "async-hooks-resource",
  anchors: {
    anchor: "machinen-real-async-hooks-resource-refusal-anchor-v1",
    marker: "async-context:async-hooks-resource-refusal:unsupported",
  },
  semanticState: {
    kind: "async-hooks-resource-refusal",
    anchor: "machinen-real-async-hooks-resource-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-async-hooks-resource-unsupported",
  refusalReason:
    "async hooks resource refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
