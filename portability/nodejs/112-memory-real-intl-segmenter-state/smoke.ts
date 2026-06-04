#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "112-memory-real-intl-segmenter-state",
  rowDir: "portability/nodejs/112-memory-real-intl-segmenter-state",
  kind: "machinen.nodejs-portability-memory-real-intl-segmenter-state-smoke-report",
  shape: "intl-segmenter-state",
  anchors: {
    anchor: "machinen-real-intl-segmenter-state-anchor-v1",
    marker: "intl-objects:intl-segmenter-state:unsupported",
  },
  semanticState: {
    kind: "intl-segmenter-state",
    anchor: "machinen-real-intl-segmenter-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-intl-segmenter-unsupported",
  refusalReason:
    "intl segmenter state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
