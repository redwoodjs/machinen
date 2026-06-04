#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "246-memory-real-vm-sandbox-global-refusal",
  rowDir: "portability/nodejs/246-memory-real-vm-sandbox-global-refusal",
  kind: "machinen.nodejs-portability-memory-real-vm-sandbox-global-refusal-smoke-report",
  shape: "vm-sandbox-global",
  anchors: {
    anchor: "machinen-real-vm-sandbox-global-refusal-anchor-v1",
    marker: "vm-module:vm-sandbox-global-refusal:unsupported",
  },
  semanticState: {
    kind: "vm-sandbox-global-refusal",
    anchor: "machinen-real-vm-sandbox-global-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-vm-sandbox-global-unsupported",
  refusalReason:
    "vm sandbox global refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
