#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "103-memory-real-headers-state",
  rowDir: "portability/nodejs/103-memory-real-headers-state",
  kind: "machinen.nodejs-portability-memory-real-headers-state-smoke-report",
  shape: "headers-state",
  anchors: {
    anchor: "machinen-real-headers-state-anchor-v1",
    marker: "web-api-state:headers-state:unsupported",
  },
  semanticState: {
    kind: "headers-state",
    anchor: "machinen-real-headers-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-headers-unsupported",
  refusalReason:
    "headers state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
