#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "051-memory-real-error-object",
  rowDir: "portability/nodejs/051-memory-real-error-object",
  kind: "machinen.nodejs-portability-memory-real-error-object-smoke-report",
  shape: "error-object",
  anchors: {
    anchor: "machinen-real-error-object-anchor-v1",
    name: "error-name:MachinenPortableError",
    message: "error-message:machinen-error-message-v1",
    code: "error-code:MACHINEN_PORTABLE_ERROR",
    cause: "error-cause:machinen-error-cause-message-v1",
  },
  semanticState: {
    kind: "error-object",
    anchor: "machinen-real-error-object-anchor-v1",
    name: "MachinenPortableError",
    message: "machinen-error-message-v1",
    code: "MACHINEN_PORTABLE_ERROR",
    causeName: "TypeError",
    causeMessage: "machinen-error-cause-message-v1",
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
