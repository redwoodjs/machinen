#!/usr/bin/env tsx
import { translateNativeStack } from "../packages/runtime/src/native-stack-translation.ts";
import {
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-stack-translate.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-stack-translate-");
  try {
    emitResult(verifyNativeStackTranslation(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeStackTranslation() {
  const result = translateNativeStack({
    stackMapping: "mapping:stack",
    targetStackBase: "0x7fffffffe000",
    codeLocations: [
      {
        id: "code:return",
        sourceMapping: "mapping:text",
        sourceAddress: "0x400180",
        targetAddress: "0x14000180",
        state: "mapped",
      },
    ],
    frames: [
      {
        id: "frame:main",
        sourceSp: "0x7fff0000",
        sourceReturnAddress: "0x400180",
        sizeBytes: 64,
        metadata: "dwarf",
        locals: [{ offset: 24, kind: "pointer", sourceValue: "0x600000", targetValue: "0x700000" }],
      },
    ],
  });
  if (result.refusals.length !== 0 || result.relocations.length !== 2) {
    throw new Error(
      "native stack translation proof did not translate return address plus pointer slot",
    );
  }
  return { formatVersion: 1, result };
}

function printSummary(summary: ReturnType<typeof verifyNativeStackTranslation>) {
  console.log(
    `native-stack-translate: relocations=${summary.result.relocations.length} refusals=${summary.result.refusals.length}`,
  );
}

main();
