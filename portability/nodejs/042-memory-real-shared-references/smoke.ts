#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "042-memory-real-shared-references",
  rowDir: "portability/nodejs/042-memory-real-shared-references",
  kind: "machinen.nodejs-portability-memory-real-shared-references-smoke-report",
  shape: "shared-references",
  anchors: {
    anchor: "machinen-real-shared-anchor-v1",
    shared: "shared-node:alpha",
  },
  semanticState: {
    kind: "shared-references",
    anchor: "machinen-real-shared-anchor-v1",
    left: {
      ref: "alpha",
    },
    right: {
      ref: "alpha",
    },
    sharedIdentity: true,
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
