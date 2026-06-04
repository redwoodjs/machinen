#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "056-memory-real-symbol-keyed-object",
  rowDir: "portability/nodejs/056-memory-real-symbol-keyed-object",
  kind: "machinen.nodejs-portability-memory-real-symbol-keyed-object-smoke-report",
  shape: "symbol-keyed-object",
  anchors: {
    anchor: "machinen-real-symbol-keyed-object-anchor-v1",
    symbol: "symbol-description:machinen.secret",
    value: "symbol-value:portable-symbol-value",
    globalSymbol: "global-symbol:machinen.global",
  },
  semanticState: {
    kind: "symbol-keyed-object",
    anchor: "machinen-real-symbol-keyed-object-anchor-v1",
    stringKeys: ["visible"],
    symbolProperties: [
      {
        registry: "local",
        description: "machinen.secret",
        value: "portable-symbol-value",
      },
      {
        registry: "global",
        description: "machinen.global",
        value: 56,
      },
    ],
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
