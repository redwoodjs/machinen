#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "111-memory-real-intl-locale-state",
  rowDir: "portability/nodejs/111-memory-real-intl-locale-state",
  kind: "machinen.nodejs-portability-memory-real-intl-locale-state-smoke-report",
  shape: "intl-locale-state",
  anchors: {
    anchor: "machinen-real-intl-locale-state-anchor-v1",
    marker: "intl-objects:intl-locale-state:unsupported",
  },
  semanticState: {
    kind: "intl-locale-state",
    anchor: "machinen-real-intl-locale-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-intl-locale-unsupported",
  refusalReason:
    "intl locale state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
