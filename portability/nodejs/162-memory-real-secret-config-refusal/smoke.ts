#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "162-memory-real-secret-config-refusal",
  rowDir: "portability/nodejs/162-memory-real-secret-config-refusal",
  kind: "machinen.nodejs-portability-memory-real-secret-config-refusal-smoke-report",
  shape: "secret-config",
  anchors: {
    anchor: "machinen-real-secret-config-refusal-anchor-v1",
    marker: "config-state:secret-config-refusal:unsupported",
  },
  semanticState: {
    kind: "secret-config-refusal",
    anchor: "machinen-real-secret-config-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-secret-config-unsupported",
  refusalReason:
    "secret config refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
