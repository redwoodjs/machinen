#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "043-memory-real-cycle",
  rowDir: "portability/nodejs/043-memory-real-cycle",
  kind: "machinen.nodejs-portability-memory-real-cycle-smoke-report",
  shape: "cycle",
  anchors: {
    anchor: "machinen-real-cycle-anchor-v1",
    cycle: "cycle-node:self",
  },
  semanticState: {
    kind: "cycle",
    anchor: "machinen-real-cycle-anchor-v1",
    node: {
      name: "self",
    },
    cyclePreserved: true,
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
