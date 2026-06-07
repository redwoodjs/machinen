#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "247-memory-real-module-link-state-refusal",
  rowDir: "portability/nodejs/247-memory-real-module-link-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-module-link-state-refusal-smoke-report",
  shape: "module-link-state",
  anchors: {
    anchor: "machinen-real-module-link-state-refusal-anchor-v1",
    marker: "vm-module:module-link-state-refusal:unsupported",
  },
  semanticState: {
    kind: "module-link-state-refusal",
    anchor: "machinen-real-module-link-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-module-link-unsupported",
  refusalReason:
    "module link state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
