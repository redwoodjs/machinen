#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "217-memory-real-regexp-compiled-code-refusal",
  rowDir: "portability/nodejs/217-memory-real-regexp-compiled-code-refusal",
  kind: "machinen.nodejs-portability-memory-real-regexp-compiled-code-refusal-smoke-report",
  shape: "regexp-compiled-code",
  anchors: {
    anchor: "machinen-real-regexp-compiled-code-refusal-anchor-v1",
    marker: "regexp-detail:regexp-compiled-code-refusal:unsupported",
  },
  semanticState: {
    kind: "regexp-compiled-code-refusal",
    anchor: "machinen-real-regexp-compiled-code-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-regexp-compiled-code-unsupported",
  refusalReason:
    "regexp compiled code refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
