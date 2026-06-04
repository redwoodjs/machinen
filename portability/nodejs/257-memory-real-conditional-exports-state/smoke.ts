#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "257-memory-real-conditional-exports-state",
  rowDir: "portability/nodejs/257-memory-real-conditional-exports-state",
  kind: "machinen.nodejs-portability-memory-real-conditional-exports-state-smoke-report",
  shape: "conditional-exports-state",
  anchors: {
    anchor: "machinen-real-conditional-exports-state-anchor-v1",
    marker: "package-runtime-metadata:conditional-exports-state:unsupported",
  },
  semanticState: {
    kind: "conditional-exports-state",
    anchor: "machinen-real-conditional-exports-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-conditional-exports-unsupported",
  refusalReason:
    "conditional exports state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
