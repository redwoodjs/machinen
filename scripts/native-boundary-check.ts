#!/usr/bin/env tsx
import {
  nativeAmbiguityClasses,
  nativeSupportBoundaryChecklist,
} from "../packages/runtime/src/native-support-boundary.ts";
import {
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-boundary-check.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-boundary-");
  try {
    emitResult(verifyBoundary(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyBoundary() {
  const missing = nativeAmbiguityClasses.filter(
    (entry) => entry.requiredMetadata.length === 0 || !entry.refusalCode,
  );
  if (missing.length > 0) {
    throw new Error(
      `native support boundary has incomplete entries: ${missing.map((entry) => entry.id).join(", ")}`,
    );
  }
  return {
    formatVersion: 1,
    ambiguityClasses: nativeAmbiguityClasses.length,
    checklist: nativeSupportBoundaryChecklist(),
  };
}

function printSummary(summary: ReturnType<typeof verifyBoundary>) {
  console.log(`native-boundary-check: ambiguityClasses=${summary.ambiguityClasses}`);
}

main();
