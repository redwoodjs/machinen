#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "058-memory-real-in-memory-lru-cache",
  rowDir: "portability/nodejs/058-memory-real-in-memory-lru-cache",
  kind: "machinen.nodejs-portability-memory-real-in-memory-lru-cache-smoke-report",
  shape: "in-memory-lru-cache",
  anchors: {
    anchor: "machinen-real-lru-cache-anchor-v1",
    keys: "lru-cache-keys:beta,gamma,delta",
    evicted: "lru-cache-evicted:alpha",
    capacity: "lru-cache-capacity:3",
  },
  semanticState: {
    kind: "in-memory-lru-cache",
    anchor: "machinen-real-lru-cache-anchor-v1",
    capacity: 3,
    entriesLeastToMostRecent: [
      [
        "beta",
        {
          hits: 2,
        },
      ],
      [
        "gamma",
        {
          hits: 3,
        },
      ],
      [
        "delta",
        {
          hits: 4,
        },
      ],
    ],
    evictedKeys: ["alpha"],
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
