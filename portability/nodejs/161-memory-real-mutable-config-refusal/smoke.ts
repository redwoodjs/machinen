#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "161-memory-real-mutable-config-refusal",
  rowDir: "portability/nodejs/161-memory-real-mutable-config-refusal",
  kind: "machinen.nodejs-portability-memory-real-mutable-config-refusal-smoke-report",
  shape: "mutable-config",
  anchors: {
    anchor: "machinen-real-mutable-config-refusal-anchor-v1",
    marker: "config-state:mutable-config-refusal:unsupported",
  },
  semanticState: {
    kind: "mutable-config-refusal",
    anchor: "machinen-real-mutable-config-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-mutable-config-unsupported",
  refusalReason:
    "mutable config refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
