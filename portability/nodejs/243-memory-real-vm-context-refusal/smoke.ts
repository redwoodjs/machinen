#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "243-memory-real-vm-context-refusal",
  rowDir: "portability/nodejs/243-memory-real-vm-context-refusal",
  kind: "machinen.nodejs-portability-memory-real-vm-context-refusal-smoke-report",
  shape: "vm-context",
  anchors: {
    anchor: "machinen-real-vm-context-refusal-anchor-v1",
    marker: "vm-module:vm-context-refusal:unsupported",
  },
  semanticState: {
    kind: "vm-context-refusal",
    anchor: "machinen-real-vm-context-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-vm-context-unsupported",
  refusalReason:
    "vm context refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
