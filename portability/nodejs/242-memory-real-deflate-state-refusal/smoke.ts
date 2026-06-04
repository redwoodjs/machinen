#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "242-memory-real-deflate-state-refusal",
  rowDir: "portability/nodejs/242-memory-real-deflate-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-deflate-state-refusal-smoke-report",
  shape: "deflate-state",
  anchors: {
    anchor: "machinen-real-deflate-state-refusal-anchor-v1",
    marker: "compression:deflate-state-refusal:unsupported",
  },
  semanticState: {
    kind: "deflate-state-refusal",
    anchor: "machinen-real-deflate-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-deflate-unsupported",
  refusalReason:
    "deflate state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
