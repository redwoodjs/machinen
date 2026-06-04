#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "135-memory-real-static-fields-state",
  rowDir: "portability/nodejs/135-memory-real-static-fields-state",
  kind: "machinen.nodejs-portability-memory-real-static-fields-state-smoke-report",
  shape: "static-fields-state",
  anchors: {
    anchor: "machinen-real-static-fields-state-anchor-v1",
    marker: "class-prototype:static-fields-state:unsupported",
  },
  semanticState: {
    kind: "static-fields-state",
    anchor: "machinen-real-static-fields-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-static-fields-unsupported",
  refusalReason:
    "static fields state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
