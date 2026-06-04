#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "175-memory-real-fs-watcher-refusal",
  rowDir: "portability/nodejs/175-memory-real-fs-watcher-refusal",
  kind: "machinen.nodejs-portability-memory-real-fs-watcher-refusal-smoke-report",
  shape: "fs-watcher",
  anchors: {
    anchor: "machinen-real-fs-watcher-refusal-anchor-v1",
    marker: "filesystem-handles:fs-watcher-refusal:unsupported",
  },
  semanticState: {
    kind: "fs-watcher-refusal",
    anchor: "machinen-real-fs-watcher-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-fs-watcher-unsupported",
  refusalReason:
    "fs watcher refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
