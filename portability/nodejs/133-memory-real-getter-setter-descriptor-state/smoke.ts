#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "133-memory-real-getter-setter-descriptor-state",
  rowDir: "portability/nodejs/133-memory-real-getter-setter-descriptor-state",
  kind: "machinen.nodejs-portability-memory-real-getter-setter-descriptor-state-smoke-report",
  shape: "getter-setter-descriptor-state",
  anchors: {
    anchor: "machinen-real-getter-setter-descriptor-state-anchor-v1",
    marker: "class-prototype:getter-setter-descriptor-state:unsupported",
  },
  semanticState: {
    kind: "getter-setter-descriptor-state",
    anchor: "machinen-real-getter-setter-descriptor-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-getter-setter-descriptor-unsupported",
  refusalReason:
    "getter setter descriptor state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
