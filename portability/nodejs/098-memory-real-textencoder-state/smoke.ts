#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "098-memory-real-textencoder-state",
  rowDir: "portability/nodejs/098-memory-real-textencoder-state",
  kind: "machinen.nodejs-portability-memory-real-textencoder-state-smoke-report",
  shape: "textencoder-state",
  anchors: {
    anchor: "machinen-real-textencoder-state-anchor-v1",
    marker: "text-data:textencoder-state:unsupported",
  },
  semanticState: {
    kind: "textencoder-state",
    anchor: "machinen-real-textencoder-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-textencoder-unsupported",
  refusalReason:
    "textencoder state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
