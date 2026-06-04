#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "286-memory-real-log-correlation-state",
  rowDir: "portability/nodejs/286-memory-real-log-correlation-state",
  kind: "machinen.nodejs-portability-memory-real-log-correlation-state-smoke-report",
  shape: "log-correlation-state",
  anchors: {
    anchor: "machinen-real-log-correlation-state-anchor-v1",
    marker: "observability:log-correlation-state:unsupported",
  },
  semanticState: {
    kind: "log-correlation-state",
    anchor: "machinen-real-log-correlation-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-log-correlation-unsupported",
  refusalReason:
    "log correlation state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
