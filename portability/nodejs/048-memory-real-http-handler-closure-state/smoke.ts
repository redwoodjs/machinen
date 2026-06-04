#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "048-memory-real-http-handler-closure-state",
  rowDir: "portability/nodejs/048-memory-real-http-handler-closure-state",
  kind: "machinen.nodejs-portability-memory-real-http-handler-closure-state-smoke-report",
  shape: "http-handler-closure-state",
  anchors: {
    anchor: "machinen-real-http-closure-anchor-v1",
    hits: "http-hits:5",
  },
  semanticState: {
    kind: "http-handler-closure-state",
    anchor: "machinen-real-http-closure-anchor-v1",
    hits: 5,
    nextHit: 6,
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
