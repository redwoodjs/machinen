#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildNativeCodeMap } from "../packages/runtime/src/native-code-map.ts";
import { translateNativeMemory } from "../packages/runtime/src/native-memory-translation.ts";
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import { translateNativeStack } from "../packages/runtime/src/native-stack-translation.ts";
import {
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  NATIVE_RESTORE_LOADER_SOURCE,
  bundleFileStats,
  compileNativeRestoreLoader,
  createProofBinAndBundleDirs,
  ensureSourcesExist,
  jsonDocument,
} from "./controlled-corpus-utils.mjs";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-controlled-restore.ts [verify] [--out-dir path] [--json] [--keep]";
const PAGE_SIZE = 4096;
const MARKER = "machinen-native-controlled-restore-v1";
function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-controlled-restore-");
  try {
    emitResult(verifyNativeControlledRestore(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeControlledRestore(outDir: string) {
  ensureSourcesExist([NATIVE_RESTORE_LOADER_SOURCE]);
  const { binDir, bundleDir } = createProofBinAndBundleDirs(outDir);
  const loader = compileNativeRestoreLoader(binDir);

  const codeMap = buildNativeCodeMap(codeMapInput());
  const registers = translateNativeRegisterState(registerInput());
  const stack = translateNativeStack(stackInput(codeMap.codeLocations));
  const memory = translateNativeMemory(memoryInput());
  const resources = translateNativeResources(resourceInput());
  validateTranslationSteps({ codeMap, registers, stack, memory, resources });

  writeBundle(bundleDir, { codeMap, registers, stack, memory, resources });
  const loaderEvent = materializeTranslatedMemory(loader, bundleDir);
  const refusal = missingMetadataRefusal();
  validateLoaderEvent(loaderEvent);

  return {
    formatVersion: 1,
    bundleDir,
    loader,
    codeLocations: codeMap.codeLocations.length,
    registerThreads: registers.threads.length,
    stackRelocations: stack.relocations.length,
    memoryRelocations: memory.relocations.length,
    resourceRecipes: resources.resources.filter((resource) => resource.state === "recipe").length,
    loaderEvent,
    refusal,
    execution: "materialized-translated-state-without-final-jump",
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function codeMapInput() {
  return {
    expectedTargetBuildId: "45045045",
    targetBuildId: "45045045",
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

function registerInput() {
  return {
    sourceArch: "arm64" as const,
    targetArch: "amd64" as const,
    threads: [
      {
        id: "thread:main",
        state: "stopped" as const,
        stopReason: "ptrace-stop" as const,
        stackMapping: "mapping:stack",
        sourceRegisters: {
          arch: "arm64" as const,
          pc: "0x400120",
          sp: "0x700000000f00",
          pstate: "0x0",
          x: Array.from({ length: 31 }, () => "0x0"),
        },
        syscall: { state: "outside-syscall" as const },
        signal: {
          blocked: [],
          pending: [],
          activeFrame: false,
          altStack: { state: "disabled" as const },
        },
        tls: { threadPointer: "0x700000000800", rseq: { state: "absent" as const } },
      },
    ],
    continuations: {
      "thread:main": {
        sourcePc: "0x400120",
        targetIp: "0x14000120",
        targetSp: "0x7fffffffe000",
        targetTls: "0x7ffff7d00000",
      },
    },
  };
}

function stackInput(codeLocations: ReturnType<typeof buildNativeCodeMap>["codeLocations"]) {
  return {
    stackMapping: "mapping:stack",
    targetStackBase: "0x7fffffffe000",
    codeLocations,
    frames: [
      {
        id: "frame:main",
        sourceSp: "0x700000000f00",
        sourceReturnAddress: "0x400120",
        sizeBytes: 64,
        metadata: "dwarf" as const,
        locals: [
          {
            offset: 24,
            kind: "pointer" as const,
            sourceValue: "0x600000",
            targetValue: "0x700000",
          },
        ],
      },
    ],
  };
}

function memoryInput() {
  return {
    words: [
      {
        mapping: "mapping:data",
        offset: 8,
        sourceValue: "0x600000",
        targetValue: "0x700000",
        classification: "pointer" as const,
        proof: "sidecar" as const,
      },
    ],
  };
}

function resourceInput() {
  return {
    resources: [
      {
        id: "argv",
        kind: "argv" as const,
        state: "captured" as const,
        recipe: { argv: ["native-controlled"] },
      },
      {
        id: "fd:file",
        kind: "file" as const,
        state: "captured" as const,
        fd: 3,
        path: "/tmp/native-controlled.txt",
        offset: 9,
      },
    ],
  };
}

function validateTranslationSteps(steps: {
  codeMap: ReturnType<typeof buildNativeCodeMap>;
  registers: ReturnType<typeof translateNativeRegisterState>;
  stack: ReturnType<typeof translateNativeStack>;
  memory: ReturnType<typeof translateNativeMemory>;
  resources: ReturnType<typeof translateNativeResources>;
}) {
  assert(steps.codeMap.refusals.length === 0, "controlled code map refused unexpectedly");
  assert(
    steps.registers.refusals.length === 0,
    "controlled register translation refused unexpectedly",
  );
  assert(steps.stack.refusals.length === 0, "controlled stack translation refused unexpectedly");
  assert(steps.memory.refusals.length === 0, "controlled memory translation refused unexpectedly");
  assert(
    steps.resources.refusals.length === 0,
    "controlled resource translation refused unexpectedly",
  );
}

function writeBundle(
  bundleDir: string,
  steps: {
    codeMap: ReturnType<typeof buildNativeCodeMap>;
    registers: ReturnType<typeof translateNativeRegisterState>;
    stack: ReturnType<typeof translateNativeStack>;
    memory: ReturnType<typeof translateNativeMemory>;
    resources: ReturnType<typeof translateNativeResources>;
  },
) {
  writeFileSync(join(bundleDir, "native-memory.bin"), memoryPage());
  writeFileSync(join(bundleDir, "native-process.json"), jsonDocument(manifest()));
  writeFileSync(join(bundleDir, "native-mappings.json"), jsonDocument(mappings()));
  writeFileSync(join(bundleDir, "native-threads.json"), jsonDocument(threads()));
  writeFileSync(
    join(bundleDir, "native-resources.json"),
    jsonDocument({
      formatVersion: 1,
      resources: steps.resources.resources,
      refusals: emptyRefusals(),
    }),
  );
  writeFileSync(
    join(bundleDir, "native-translation.json"),
    jsonDocument({
      formatVersion: 1,
      mode: "native-cross-isa",
      sourceArch: "arm64",
      targetArch: "amd64",
      codeLocations: steps.codeMap.codeLocations,
      threads: steps.registers.threads,
      memoryRelocations: [...steps.stack.relocations, ...steps.memory.relocations],
      refusals: emptyRefusals(),
    }),
  );
}

function manifest() {
  return {
    formatVersion: 1,
    kind: "machinen.native-process-image",
    capture: { method: "external-ptrace-procfs", sourceArch: "arm64", pid: 450 },
    target: { mode: "native-cross-isa", arch: "amd64", abi: "linux-user" },
    process: { exe: "/controlled/native", argv: ["native-controlled"], env: {}, cwd: "/tmp" },
    refusals: emptyRefusals(),
  };
}

function mappings() {
  return {
    formatVersion: 1,
    mappings: [
      {
        id: "mapping:arm64-text",
        kind: "text",
        sourceStart: "0x400000",
        sourceEnd: "0x401000",
        sizeBytes: PAGE_SIZE,
        permissions: { read: true, write: false, execute: true, private: true, shared: false },
        target: { materialization: "translate", targetStart: "0x14000000" },
      },
      {
        id: "mapping:data",
        kind: "data",
        sourceStart: "0x600000",
        sourceEnd: "0x601000",
        sizeBytes: PAGE_SIZE,
        permissions: { read: true, write: true, execute: false, private: true, shared: false },
        captured: { file: "native-memory.bin", offset: 0, sizeBytes: PAGE_SIZE },
        target: { materialization: "translate", targetStart: "0x700000" },
      },
      {
        id: "mapping:stack",
        kind: "stack",
        sourceStart: "0x700000000000",
        sourceEnd: "0x700000001000",
        sizeBytes: PAGE_SIZE,
        permissions: { read: true, write: true, execute: false, private: true, shared: false },
        captured: { file: "native-memory.bin", offset: 0, sizeBytes: PAGE_SIZE },
        target: { materialization: "translate", targetStart: "0x7fffffffd000" },
      },
    ],
    refusals: emptyRefusals(),
  };
}

function threads() {
  return { formatVersion: 1, threads: registerInput().threads, refusals: emptyRefusals() };
}

function emptyRefusals() {
  return { vocabularyVersion: 1, refusals: [] };
}

function memoryPage() {
  const page = Buffer.alloc(PAGE_SIZE);
  page.write(MARKER, 0, "utf8");
  return page;
}

function materializeTranslatedMemory(loader: string, bundleDir: string) {
  const result = spawnSync(
    loader,
    [
      "--memory",
      join(bundleDir, "native-memory.bin"),
      "--offset",
      "0",
      "--size",
      String(PAGE_SIZE),
      "--expect-prefix",
      MARKER,
      "--final-prot",
      "rw",
    ],
    { encoding: "utf8" },
  );
  assert(result.status === 0, `native controlled restore loader failed: ${result.stderr}`);
  const line = result.stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("MACHINEN_NATIVE_RESTORE_LOADER "));
  assert(line, "native controlled restore loader did not emit a materialization event");
  return JSON.parse(line.slice("MACHINEN_NATIVE_RESTORE_LOADER ".length));
}

function missingMetadataRefusal() {
  const result = translateNativeStack({
    stackMapping: "mapping:stack",
    targetStackBase: "0x7fffffffe000",
    codeLocations: [],
    frames: [
      {
        id: "frame:ambiguous",
        sourceSp: "0x700000000f00",
        sourceReturnAddress: "0x400120",
        sizeBytes: 64,
        metadata: "unknown",
        locals: [],
      },
    ],
  });
  return result.refusals[0];
}

function validateLoaderEvent(loaderEvent: { status?: string; sizeBytes?: number }) {
  assert(
    loaderEvent.status === "materialized",
    "native controlled restore did not materialize memory",
  );
  assert(loaderEvent.sizeBytes === PAGE_SIZE, "native controlled restore materialized wrong size");
}

function printSummary(summary: ReturnType<typeof verifyNativeControlledRestore>) {
  console.log(
    `native-controlled-restore: code=${summary.codeLocations} registers=${summary.registerThreads} stackRelocs=${summary.stackRelocations} memoryRelocs=${summary.memoryRelocations} resources=${summary.resourceRecipes}`,
  );
  console.log(
    `native-controlled-restore: ${summary.loaderEvent.status} ${summary.loaderEvent.sizeBytes} bytes; execution=${summary.execution}`,
  );
}

main();
