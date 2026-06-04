#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "050-memory-real-date-regexp",
  rowDir: "portability/nodejs/050-memory-real-date-regexp",
  kind: "machinen.nodejs-portability-memory-real-date-regexp-smoke-report",
  shape: "date-regexp",
  anchors: {
    anchor: "machinen-real-date-regexp-anchor-v1",
    dateIso: "date-iso:2026-06-04T05:55:16.123Z",
    regexpSource: "regexp-source:machinen-(portable)-(date-regexp)",
    regexpFlags: "regexp-flags:giu",
  },
  semanticState: {
    kind: "date-regexp",
    anchor: "machinen-real-date-regexp-anchor-v1",
    dateIso: "2026-06-04T05:55:16.123Z",
    dateEpochMs: 1780552516123,
    regexpSource: "machinen-(portable)-(date-regexp)",
    regexpFlags: "giu",
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
