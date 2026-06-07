#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "290-memory-real-provider-factory-refusal",
  rowDir: "portability/nodejs/290-memory-real-provider-factory-refusal",
  kind: "machinen.nodejs-portability-memory-real-provider-factory-refusal-smoke-report",
  shape: "provider-factory",
  anchors: {
    anchor: "machinen-real-provider-factory-refusal-anchor-v1",
    marker: "dependency-injection:provider-factory-refusal:unsupported",
  },
  semanticState: {
    kind: "provider-factory-refusal",
    anchor: "machinen-real-provider-factory-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-provider-factory-unsupported",
  refusalReason:
    "provider factory refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
