#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "054-memory-real-module-singleton-state",
  rowDir: "portability/nodejs/054-memory-real-module-singleton-state",
  kind: "machinen.nodejs-portability-memory-real-module-singleton-state-smoke-report",
  shape: "module-singleton-state",
  anchors: {
    anchor: "machinen-real-module-singleton-anchor-v1",
    module: "module-singleton-name:machinen-portable-singleton-module-v1",
    counter: "module-singleton-counter:19",
    token: "module-singleton-token:machinen-singleton-token-v1",
  },
  semanticState: {
    kind: "module-singleton-state",
    anchor: "machinen-real-module-singleton-anchor-v1",
    moduleName: "machinen-portable-singleton-module-v1",
    counter: 19,
    token: "machinen-singleton-token-v1",
    nested: { warmed: true, label: "machinen-singleton-nested-label-v1" },
    lastTouch: "machinen-singleton-last-touch-v1",
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
