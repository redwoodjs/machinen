#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "040-memory-real-string",
  rowDir: "portability/nodejs/040-memory-real-string",
  kind: "machinen.nodejs-portability-memory-real-string-smoke-report",
  shape: "string",
  anchors: {
    anchor: "machinen-real-string-anchor-v1",
    value: "real-string-value:portable",
  },
  semanticState: {
    kind: "string",
    anchor: "machinen-real-string-anchor-v1",
    value: "portable",
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
