#!/usr/bin/env tsx
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planNativeMappingMaterialization } from "../packages/runtime/src/native-mapping-materialization.ts";
import type { NativeMemoryMapping } from "../packages/runtime/src/native-process-image.ts";
import {
  NATIVE_MAPPING_MATERIALIZER_SOURCE,
  compileNativeMappingMaterializer,
  createProofBinAndBundleDirs,
  ensureSourcesExist,
  sha256File,
} from "./controlled-corpus-utils.mjs";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  emitSkip,
  parseVerifyArgs,
  runCommand,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-mapping-materializer.ts [verify] [--out-dir path] [--json] [--keep]";
const PAGE_SIZE = 4096;
const TEXT_PREFIX = "machinen-native-mapping-materializer-text-v1";
const DATA_WORD0 = 0x444154414d41504en;
const HEAP_WORD0 = 0x484541504d41504en;
const TEXT_TARGET_START = 0x620000000000n;
const DATA_TARGET_START = 0x620000010000n;
const HEAP_TARGET_START = 0x620000020000n;
const STACK_TARGET_START = 0x620000030000n;
const RECREATE_TARGET_START = 0x620000050000n;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(args, "native-mapping-materializer", "target mmap materializer uses Linux procfs");
    return;
  }
  const workspace = createWorkspace(args, "machinen-native-mapping-materializer-");
  try {
    emitResult(verifyNativeMappingMaterializer(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeMappingMaterializer(outDir: string) {
  ensureSourcesExist([NATIVE_MAPPING_MATERIALIZER_SOURCE]);
  const { binDir, bundleDir } = createProofBinAndBundleDirs(outDir);
  const materializer = compileNativeMappingMaterializer(binDir);
  const textFile = join(bundleDir, "target-text-page.bin");
  const memoryFile = join(bundleDir, "native-memory.bin");
  writeFileSync(textFile, textPage());
  chmodSync(textFile, 0o755);
  writeFileSync(memoryFile, Buffer.concat([wordPage(DATA_WORD0), wordPage(HEAP_WORD0)]));

  const textBuildId = sha256File(textFile);
  const mappings = mappingPlan(textFile, textBuildId);
  const plan = planNativeMappingMaterialization({
    mappings,
    memorySizeBytes: PAGE_SIZE * 2,
    targetFileBuildIds: { [textFile]: textBuildId },
  });
  assertAction(plan, "mapping:text", "map-target-file");
  assertAction(plan, "mapping:data", "copy-captured-bytes");
  assertAction(plan, "mapping:heap", "copy-captured-bytes");
  assertAction(plan, "mapping:stack", "recreate");
  assertAction(plan, "mapping:vdso", "recreate");
  assertAction(plan, "mapping:unreadable", "refuse");
  assert(
    plan.refusals.some((refusal) => refusal.code === "mapping-unreadable"),
    "unreadable mapping refusal was not preserved",
  );

  const materializerEvent = runMaterializer(materializer, textFile, memoryFile);
  assert(materializerEvent.status === "materialized", "materializer did not apply mappings");
  assert(materializerEvent.textPerms.startsWith("r-x"), "text mapping did not end as r-x");
  assert(materializerEvent.dataPerms.startsWith("rw-"), "data mapping did not end as rw-");
  assert(materializerEvent.heapPerms.startsWith("rw-"), "heap mapping did not end as rw-");
  assert(materializerEvent.stackPerms.startsWith("rw-"), "stack mapping did not end as rw-");
  assert(materializerEvent.recreatePerms.startsWith("---"), "recreated mapping was not PROT_NONE");
  assert(materializerEvent.dataWord0 === hex(DATA_WORD0), "data word was not copied");
  assert(materializerEvent.heapWord0 === hex(HEAP_WORD0), "heap word was not copied");

  return {
    formatVersion: 1,
    bundleDir,
    materializer,
    textFile,
    memoryFile,
    targetFileBuildId: textBuildId,
    planSteps: plan.steps,
    refusalCodes: plan.refusals.map((refusal) => refusal.code),
    materializerEvent,
    execution: "native-mapping-plan-materialized-with-target-file-and-captured-bytes",
  };
}

function mappingPlan(textFile: string, textBuildId: string): NativeMemoryMapping[] {
  return [
    {
      id: "mapping:text",
      kind: "text",
      sourceStart: "0x400000",
      sourceEnd: "0x401000",
      sizeBytes: PAGE_SIZE,
      permissions: { read: true, write: false, execute: true, private: true, shared: false },
      file: { path: textFile, offset: 0, buildId: textBuildId, sha256: textBuildId },
      target: { materialization: "translate", targetStart: hex(TEXT_TARGET_START) },
    },
    copiedMapping("mapping:data", "data", 0, DATA_TARGET_START),
    copiedMapping("mapping:heap", "heap", PAGE_SIZE, HEAP_TARGET_START),
    recreatedMapping("mapping:stack", "stack", STACK_TARGET_START, PAGE_SIZE * 2),
    recreatedMapping("mapping:vdso", "vdso", RECREATE_TARGET_START, PAGE_SIZE),
    {
      id: "mapping:unreadable",
      kind: "anonymous",
      sourceStart: "0x800000",
      sourceEnd: "0x801000",
      sizeBytes: PAGE_SIZE,
      permissions: { read: false, write: false, execute: false, private: true, shared: false },
      target: { materialization: "refuse", reason: "mapping is not readable" },
      refusal: { code: "mapping-unreadable", message: "mapping is not readable" },
    },
  ];
}

function copiedMapping(
  id: string,
  kind: "data" | "heap",
  offset: number,
  targetStart: bigint,
): NativeMemoryMapping {
  return {
    id,
    kind,
    sourceStart: offset === 0 ? "0x500000" : "0x600000",
    sourceEnd: offset === 0 ? "0x501000" : "0x601000",
    sizeBytes: PAGE_SIZE,
    permissions: { read: true, write: true, execute: false, private: true, shared: false },
    captured: { file: "native-memory.bin", offset, sizeBytes: PAGE_SIZE },
    target: { materialization: "translate", targetStart: hex(targetStart) },
  };
}

function recreatedMapping(
  id: string,
  kind: "stack" | "vdso",
  targetStart: bigint,
  sizeBytes: number,
): NativeMemoryMapping {
  return {
    id,
    kind,
    sourceStart: kind === "stack" ? "0x700000" : "0x900000",
    sourceEnd: kind === "stack" ? "0x702000" : "0x901000",
    sizeBytes,
    permissions:
      kind === "stack"
        ? { read: true, write: true, execute: false, private: true, shared: false }
        : { read: true, write: false, execute: true, private: true, shared: false },
    target: { materialization: "recreate", targetStart: hex(targetStart) },
  };
}

function textPage() {
  const page = Buffer.alloc(PAGE_SIZE);
  page.write(TEXT_PREFIX, 0, "utf8");
  return page;
}

function wordPage(word: bigint) {
  const page = Buffer.alloc(PAGE_SIZE);
  page.writeBigUInt64LE(word, 0);
  return page;
}

function assertAction(
  plan: ReturnType<typeof planNativeMappingMaterialization>,
  mapping: string,
  action: string,
) {
  const step = plan.steps.find((candidate) => candidate.mapping === mapping);
  assert(step?.action === action, `${mapping} did not plan ${action}`);
}

function runMaterializer(materializer: string, textFile: string, memoryFile: string) {
  const result = runCommand(
    materializer,
    [
      "--memory",
      memoryFile,
      "--text-file",
      textFile,
      "--text-target-start",
      hex(TEXT_TARGET_START),
      "--text-size",
      String(PAGE_SIZE),
      "--expect-text-prefix",
      TEXT_PREFIX,
      "--data-offset",
      "0",
      "--data-target-start",
      hex(DATA_TARGET_START),
      "--data-size",
      String(PAGE_SIZE),
      "--expect-data-word0",
      hex(DATA_WORD0),
      "--heap-offset",
      String(PAGE_SIZE),
      "--heap-target-start",
      hex(HEAP_TARGET_START),
      "--heap-size",
      String(PAGE_SIZE),
      "--expect-heap-word0",
      hex(HEAP_WORD0),
      "--stack-target-start",
      hex(STACK_TARGET_START),
      "--stack-size",
      String(PAGE_SIZE * 2),
      "--recreate-target-start",
      hex(RECREATE_TARGET_START),
      "--recreate-size",
      String(PAGE_SIZE),
    ],
    { label: "native mapping materializer run" },
  );
  const line = result.stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("MACHINEN_NATIVE_MAPPING_MATERIALIZER "));
  assert(line, "native mapping materializer did not emit an event");
  return JSON.parse(line.slice("MACHINEN_NATIVE_MAPPING_MATERIALIZER ".length));
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function printSummary(summary: ReturnType<typeof verifyNativeMappingMaterializer>) {
  console.log(
    `native-mapping-materializer: steps=${summary.planSteps.length} refusals=${summary.refusalCodes.join(",")}`,
  );
  console.log(`native-mapping-materializer: execution=${summary.execution}`);
}

main();
