#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { materializeNativeTargetModuleBytes } from "../packages/runtime/src/native-target-module-bytes.ts";
import type { NativeRealUtilityTargetModule } from "../packages/runtime/src/native-real-utility-code-map.ts";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-real-utility-target-module-bytes.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-real-utility-target-module-bytes-");
  try {
    emitResult(verifyTargetModuleBytes(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyTargetModuleBytes(outDir: string) {
  const targetRoot = join(outDir, "target-root");
  const targetPath = join(targetRoot, "usr/bin/realspin");
  mkdirSync(join(targetRoot, "usr/bin"), { recursive: true });
  const fileBytes = targetModuleFileBytes();
  writeFileSync(targetPath, fileBytes);
  const targetModule = proofTargetModule(sha256(fileBytes));
  const materialized = materializeNativeTargetModuleBytes({
    module: targetModule,
    targetRoot,
    relativeStart: "0x1200",
    sizeBytes: 0x80,
  });
  assert(
    materialized.refusals.length === 0,
    `target module byte materialization refused: ${JSON.stringify(materialized.refusals)}`,
  );
  const bytes = materialized.materialized?.bytes;
  assert(bytes, "target module byte materialization returned no bytes");
  assert(
    Buffer.from(bytes).includes("target-native-amd64-realspin"),
    "materialized target bytes did not contain target marker",
  );
  return {
    formatVersion: 1,
    phase: "real-utility-target-module-bytes",
    targetRoot,
    targetModule,
    materialized: {
      ...materialized.materialized,
      bytesSha256: sha256(Buffer.from(bytes)),
      bytes: undefined,
    },
    targetBytesSource: "explicit-target-root",
    sourceTextReusedAsTargetCode: false,
    execution: "real-utility-target-module-bytes-materialized-from-explicit-target-root",
  };
}

function proofTargetModule(buildId: string): NativeRealUtilityTargetModule {
  return {
    id: "target:realspin",
    logicalName: "realspin",
    path: "/usr/bin/realspin",
    arch: "amd64",
    kind: "pie-executable",
    buildId,
    loadBias: "0x700000000000",
    textMapping: "target:mapping:realspin-text",
    executable: true,
    executableRanges: [{ relativeStart: "0x1000", relativeEnd: "0x2000" }],
  };
}

function targetModuleFileBytes() {
  const bytes = Buffer.alloc(0x3000, 0xcc);
  bytes.write("target-native-amd64-realspin", 0x1234, "utf8");
  return bytes;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function printSummary(summary: ReturnType<typeof verifyTargetModuleBytes>) {
  console.log(
    `native-real-utility-target-module-bytes: source=${summary.targetBytesSource} sha256=${summary.materialized.bytesSha256}`,
  );
  console.log(`native-real-utility-target-module-bytes: execution=${summary.execution}`);
}

main();
