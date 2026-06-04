#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "160-memory-real-immutable-config-object-state",
  rowDir: "portability/nodejs/160-memory-real-immutable-config-object-state",
  kind: "machinen.nodejs-portability-memory-real-immutable-config-object-state-smoke-report",
  shape: "immutable-config-object-state",
  anchors: {
    anchor: "machinen-real-immutable-config-object-state-anchor-v1",
    marker: "config-state:immutable-config-object-state:unsupported",
  },
  semanticState: {
    kind: "immutable-config-object-state",
    anchor: "machinen-real-immutable-config-object-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-immutable-config-object-unsupported",
  refusalReason:
    "immutable config object state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
