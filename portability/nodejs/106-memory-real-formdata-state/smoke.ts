#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "106-memory-real-formdata-state",
  rowDir: "portability/nodejs/106-memory-real-formdata-state",
  kind: "machinen.nodejs-portability-memory-real-formdata-state-smoke-report",
  shape: "formdata-state",
  anchors: {
    anchor: "machinen-real-formdata-state-anchor-v1",
    marker: "web-api-state:formdata-state:unsupported",
  },
  semanticState: {
    kind: "formdata-state",
    anchor: "machinen-real-formdata-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-formdata-unsupported",
  refusalReason:
    "formdata state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
