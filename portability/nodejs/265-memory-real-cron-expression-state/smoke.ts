#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "265-memory-real-cron-expression-state",
  rowDir: "portability/nodejs/265-memory-real-cron-expression-state",
  kind: "machinen.nodejs-portability-memory-real-cron-expression-state-smoke-report",
  shape: "cron-expression-state",
  anchors: {
    anchor: "machinen-real-cron-expression-state-anchor-v1",
    marker: "job-schedulers:cron-expression-state:unsupported",
  },
  semanticState: {
    kind: "cron-expression-state",
    anchor: "machinen-real-cron-expression-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-cron-expression-unsupported",
  refusalReason:
    "cron expression state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
