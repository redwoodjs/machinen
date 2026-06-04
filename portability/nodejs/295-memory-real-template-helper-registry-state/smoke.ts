#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "295-memory-real-template-helper-registry-state",
  rowDir: "portability/nodejs/295-memory-real-template-helper-registry-state",
  kind: "machinen.nodejs-portability-memory-real-template-helper-registry-state-smoke-report",
  shape: "template-helper-registry-state",
  anchors: {
    anchor: "machinen-real-template-helper-registry-state-anchor-v1",
    marker: "template-render:template-helper-registry-state:unsupported",
  },
  semanticState: {
    kind: "template-helper-registry-state",
    anchor: "machinen-real-template-helper-registry-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-template-helper-registry-unsupported",
  refusalReason:
    "template helper registry state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
