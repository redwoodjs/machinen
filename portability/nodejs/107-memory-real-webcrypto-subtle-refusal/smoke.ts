#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "107-memory-real-webcrypto-subtle-refusal",
  rowDir: "portability/nodejs/107-memory-real-webcrypto-subtle-refusal",
  kind: "machinen.nodejs-portability-memory-real-webcrypto-subtle-refusal-smoke-report",
  shape: "webcrypto-subtle",
  anchors: {
    anchor: "machinen-real-webcrypto-subtle-refusal-anchor-v1",
    marker: "web-api-state:webcrypto-subtle-refusal:unsupported",
  },
  semanticState: {
    kind: "webcrypto-subtle-refusal",
    anchor: "machinen-real-webcrypto-subtle-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-webcrypto-subtle-unsupported",
  refusalReason:
    "webcrypto subtle refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
