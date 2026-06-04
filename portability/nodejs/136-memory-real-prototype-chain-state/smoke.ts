#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "136-memory-real-prototype-chain-state",
  rowDir: "portability/nodejs/136-memory-real-prototype-chain-state",
  kind: "machinen.nodejs-portability-memory-real-prototype-chain-state-smoke-report",
  shape: "prototype-chain-state",
  anchors: {
    anchor: "machinen-real-prototype-chain-state-anchor-v1",
    marker: "class-prototype:prototype-chain-state:unsupported",
  },
  semanticState: {
    kind: "prototype-chain-state",
    anchor: "machinen-real-prototype-chain-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-prototype-chain-unsupported",
  refusalReason:
    "prototype chain state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
