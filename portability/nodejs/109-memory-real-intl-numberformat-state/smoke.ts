#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "109-memory-real-intl-numberformat-state",
  rowDir: "portability/nodejs/109-memory-real-intl-numberformat-state",
  kind: "machinen.nodejs-portability-memory-real-intl-numberformat-state-smoke-report",
  shape: "intl-numberformat-state",
  anchors: {
    anchor: "machinen-real-intl-numberformat-state-anchor-v1",
    marker: "intl-objects:intl-numberformat-state:unsupported",
  },
  semanticState: {
    kind: "intl-numberformat-state",
    anchor: "machinen-real-intl-numberformat-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-intl-numberformat-unsupported",
  refusalReason:
    "intl numberformat state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
