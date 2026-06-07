#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "059-memory-real-queue-state",
  rowDir: "portability/nodejs/059-memory-real-queue-state",
  kind: "machinen.nodejs-portability-memory-real-queue-state-smoke-report",
  shape: "queue-state",
  anchors: {
    anchor: "machinen-real-queue-state-anchor-v1",
    head: "queue-head:job-002",
    tail: "queue-tail:job-004",
    items: "queue-items:job-002,job-003,job-004",
  },
  semanticState: {
    kind: "queue-state",
    anchor: "machinen-real-queue-state-anchor-v1",
    headIndex: 1,
    tailIndex: 3,
    pending: [
      {
        id: "job-002",
        priority: 5,
      },
      {
        id: "job-003",
        priority: 3,
      },
      {
        id: "job-004",
        priority: 1,
      },
    ],
    processed: ["job-001"],
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
