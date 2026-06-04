#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "130-memory-real-sharedarraybuffer-refusal",
  rowDir: "portability/nodejs/130-memory-real-sharedarraybuffer-refusal",
  kind: "machinen.nodejs-portability-memory-real-sharedarraybuffer-refusal-smoke-report",
  shape: "sharedarraybuffer",
  anchors: {
    anchor: "machinen-real-sharedarraybuffer-refusal-anchor-v1",
    marker: "typed-array-advanced:sharedarraybuffer-refusal:unsupported",
  },
  semanticState: {
    kind: "sharedarraybuffer-refusal",
    anchor: "machinen-real-sharedarraybuffer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-sharedarraybuffer-unsupported",
  refusalReason:
    "sharedarraybuffer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
