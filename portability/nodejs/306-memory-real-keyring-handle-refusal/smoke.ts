#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "306-memory-real-keyring-handle-refusal",
  rowDir: "portability/nodejs/306-memory-real-keyring-handle-refusal",
  kind: "machinen.nodejs-portability-memory-real-keyring-handle-refusal-smoke-report",
  shape: "keyring-handle",
  anchors: {
    anchor: "machinen-real-keyring-handle-refusal-anchor-v1",
    marker: "security-sensitive:keyring-handle-refusal:unsupported",
  },
  semanticState: {
    kind: "keyring-handle-refusal",
    anchor: "machinen-real-keyring-handle-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-keyring-handle-unsupported",
  refusalReason:
    "keyring handle refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
