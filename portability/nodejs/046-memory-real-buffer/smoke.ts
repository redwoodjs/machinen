#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "046-memory-real-buffer",
  rowDir: "portability/nodejs/046-memory-real-buffer",
  kind: "machinen.nodejs-portability-memory-real-buffer-smoke-report",
  shape: "buffer",
  anchors: {
    anchor: "machinen-real-buffer-anchor-v1",
    bytes: "buffer-bytes:6d616368696e656e",
  },
  semanticState: {
    kind: "buffer",
    anchor: "machinen-real-buffer-anchor-v1",
    utf8: "machinen",
    hex: "6d616368696e656e",
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
