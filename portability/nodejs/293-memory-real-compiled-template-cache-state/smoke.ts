#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "293-memory-real-compiled-template-cache-state",
  rowDir: "portability/nodejs/293-memory-real-compiled-template-cache-state",
  kind: "machinen.nodejs-portability-memory-real-compiled-template-cache-state-smoke-report",
  shape: "compiled-template-cache-state",
  anchors: {
    anchor: "machinen-real-compiled-template-cache-state-anchor-v1",
    marker: "template-render:compiled-template-cache-state:unsupported",
  },
  semanticState: {
    kind: "compiled-template-cache-state",
    anchor: "machinen-real-compiled-template-cache-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-compiled-template-cache-unsupported",
  refusalReason:
    "compiled template cache state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
