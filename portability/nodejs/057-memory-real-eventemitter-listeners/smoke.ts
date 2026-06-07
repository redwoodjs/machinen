#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "057-memory-real-eventemitter-listeners",
  rowDir: "portability/nodejs/057-memory-real-eventemitter-listeners",
  kind: "machinen.nodejs-portability-memory-real-eventemitter-listeners-smoke-report",
  shape: "eventemitter-listeners",
  anchors: {
    anchor: "machinen-real-eventemitter-listeners-anchor-v1",
    event: "eventemitter-event:portable-event",
    listeners: "eventemitter-listeners:2",
    listenerLabel: "eventemitter-listener-label:audit-listener",
  },
  semanticState: {
    kind: "eventemitter-listeners",
    anchor: "machinen-real-eventemitter-listeners-anchor-v1",
    eventName: "portable-event",
    listenerCount: 2,
    listenerLabels: ["audit-listener", "metrics-listener"],
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
