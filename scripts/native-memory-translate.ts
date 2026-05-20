#!/usr/bin/env tsx
import { translateNativeMemory } from "../packages/runtime/src/native-memory-translation.ts";
import {
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-memory-translate.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-memory-translate-");
  try {
    emitResult(verifyNativeMemoryTranslation(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

// fallow-ignore-next-line complexity
function verifyNativeMemoryTranslation() {
  const result = translateNativeMemory({
    words: [
      {
        mapping: "mapping:data",
        offset: 0,
        sourceValue: "0x2a",
        classification: "integer",
        proof: "dwarf",
      },
      {
        mapping: "mapping:data",
        offset: 8,
        sourceValue: "0x600000",
        targetValue: "0x700000",
        classification: "pointer",
        proof: "sidecar",
      },
      {
        mapping: "mapping:data",
        offset: 16,
        sourceValue: "0x700000",
        classification: "ambiguous",
        proof: "none",
      },
    ],
  });
  if (result.preservedWords !== 1 || result.relocations.length !== 1) {
    throw new Error(
      "native memory translation proof did not preserve one integer and relocate one pointer",
    );
  }
  if (result.refusals[0]?.code !== "pointer-ambiguous") {
    throw new Error("native memory translation proof did not refuse the ambiguous word");
  }
  return { formatVersion: 1, result };
}

function printSummary(summary: ReturnType<typeof verifyNativeMemoryTranslation>) {
  console.log(
    `native-memory-translate: preserved=${summary.result.preservedWords} relocations=${summary.result.relocations.length} refusals=${summary.result.refusals.length}`,
  );
}

main();
