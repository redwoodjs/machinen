#!/usr/bin/env tsx
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import {
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-resource-translate.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-resource-translate-");
  try {
    emitResult(verifyNativeResourceTranslation(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeResourceTranslation() {
  const result = translateNativeResources({
    resources: [
      { id: "fd:file", kind: "file", state: "captured", fd: 3, path: "/tmp/data.txt", offset: 9 },
      { id: "fd:socket", kind: "socket", state: "captured", fd: 4, path: "socket:[1]" },
    ],
  });
  if (result.resources[0]?.state !== "recipe") {
    throw new Error("regular file did not produce a restore recipe");
  }
  if (result.refusals[0]?.code !== "resource-kind-unsupported") {
    throw new Error("brokerless socket did not refuse precisely");
  }
  return { formatVersion: 1, result };
}

function printSummary(summary: ReturnType<typeof verifyNativeResourceTranslation>) {
  console.log(
    `native-resource-translate: resources=${summary.result.resources.length} refusals=${summary.result.refusals.length}`,
  );
}

main();
