#!/usr/bin/env tsx
import { buildNativeCodeMap } from "../packages/runtime/src/native-code-map.ts";
import {
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE = "usage: tsx scripts/native-code-map.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-code-map-");
  try {
    emitResult(verifyNativeCodeMap(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

// fallow-ignore-next-line complexity
function verifyNativeCodeMap() {
  const mapped = buildNativeCodeMap({
    expectedTargetBuildId: "b16b00b5",
    targetBuildId: "b16b00b5",
    sourceSymbols: [
      {
        name: "native_controlled_resume",
        mapping: "mapping:arm64-text",
        address: "0x400120",
        sizeBytes: 64,
        metadata: "dwarf",
      },
    ],
    targetSymbols: [
      {
        name: "native_controlled_resume",
        mapping: "mapping:amd64-text",
        address: "0x14000120",
        sizeBytes: 72,
        metadata: "dwarf",
      },
    ],
    requestedLocations: [{ id: "code:resume", symbol: "native_controlled_resume" }],
  });
  const mismatch = buildNativeCodeMap({
    ...mappedInputForMismatch(),
    targetBuildId: "deadbeef",
  });
  if (mapped.codeLocations[0]?.state !== "mapped") {
    throw new Error("native code map did not map the controlled resume symbol");
  }
  if (mismatch.refusals[0]?.code !== "target-build-mismatch") {
    throw new Error("native code map did not refuse a target build mismatch");
  }
  return { formatVersion: 1, mapped, mismatchRefusal: mismatch.refusals[0] };
}

function mappedInputForMismatch() {
  return {
    expectedTargetBuildId: "b16b00b5",
    targetBuildId: "b16b00b5",
    sourceSymbols: [
      {
        name: "native_controlled_resume",
        mapping: "mapping:arm64-text",
        address: "0x400120",
        sizeBytes: 64,
        metadata: "dwarf" as const,
      },
    ],
    targetSymbols: [
      {
        name: "native_controlled_resume",
        mapping: "mapping:amd64-text",
        address: "0x14000120",
        sizeBytes: 72,
        metadata: "dwarf" as const,
      },
    ],
    requestedLocations: [{ id: "code:resume", symbol: "native_controlled_resume" }],
  };
}

function printSummary(summary: ReturnType<typeof verifyNativeCodeMap>) {
  console.log(
    `native-code-map: mapped=${summary.mapped.codeLocations.length} mismatch=${summary.mismatchRefusal?.code}`,
  );
}

main();
