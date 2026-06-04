#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "259-memory-real-command-registry-state",
  rowDir: "portability/nodejs/259-memory-real-command-registry-state",
  kind: "machinen.nodejs-portability-memory-real-command-registry-state-smoke-report",
  shape: "command-registry-state",
  anchors: {
    anchor: "machinen-real-command-registry-state-anchor-v1",
    marker: "cli-app-state:command-registry-state:unsupported",
  },
  semanticState: {
    kind: "command-registry-state",
    anchor: "machinen-real-command-registry-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-command-registry-unsupported",
  refusalReason:
    "command registry state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
