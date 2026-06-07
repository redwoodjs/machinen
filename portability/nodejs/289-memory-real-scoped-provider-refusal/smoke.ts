#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "289-memory-real-scoped-provider-refusal",
  rowDir: "portability/nodejs/289-memory-real-scoped-provider-refusal",
  kind: "machinen.nodejs-portability-memory-real-scoped-provider-refusal-smoke-report",
  shape: "scoped-provider",
  anchors: {
    anchor: "machinen-real-scoped-provider-refusal-anchor-v1",
    marker: "dependency-injection:scoped-provider-refusal:unsupported",
  },
  semanticState: {
    kind: "scoped-provider-refusal",
    anchor: "machinen-real-scoped-provider-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-scoped-provider-unsupported",
  refusalReason:
    "scoped provider refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
