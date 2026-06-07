#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "173-memory-real-filehandle-refusal",
  rowDir: "portability/nodejs/173-memory-real-filehandle-refusal",
  kind: "machinen.nodejs-portability-memory-real-filehandle-refusal-smoke-report",
  shape: "filehandle",
  anchors: {
    anchor: "machinen-real-filehandle-refusal-anchor-v1",
    marker: "filesystem-handles:filehandle-refusal:unsupported",
  },
  semanticState: {
    kind: "filehandle-refusal",
    anchor: "machinen-real-filehandle-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-filehandle-unsupported",
  refusalReason:
    "filehandle refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
