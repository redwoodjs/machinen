#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  NATIVE_RESTORE_LOADER_SOURCE,
  bundleFileStats,
  compileNativeRestoreLoader,
  createProofBinAndBundleDirs,
  ensureSourcesExist,
  hostArch,
  jsonDocument,
} from "./controlled-corpus-utils.mjs";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
  runCommand,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: node scripts/native-restore-loader.mjs [verify] [--out-dir path] [--json] [--keep]";
const PAGE_SIZE = 4096;
const MARKER = "machinen-native-loader-v1";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-restore-loader-");
  try {
    emitResult(verifyNativeRestoreLoader(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeRestoreLoader(outDir) {
  ensureSourcesExist([NATIVE_RESTORE_LOADER_SOURCE]);
  const { binDir, bundleDir } = createProofBinAndBundleDirs(outDir);
  const loader = compileNativeRestoreLoader(binDir);
  const image = syntheticImage();
  writeSyntheticBundle(bundleDir, image);
  const restoreEvent = runLoader(loader, bundleDir, image.mapping);
  const missingMemoryRefusal = runMissingMemoryFailure(loader, bundleDir, image.mapping);
  validateSummary({ image, restoreEvent, missingMemoryRefusal });

  return {
    formatVersion: 1,
    hostArch: hostArch(),
    loader,
    bundleDir,
    materializedMapping: image.mapping.id,
    restoreEvent,
    missingMemoryRefusal,
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function syntheticImage() {
  const targetArch = hostArch();
  const sourceArch = oppositeArch(targetArch);
  const mapping = {
    id: "mapping:synthetic-stack",
    kind: "stack",
    sourceStart: "0x700000000000",
    sourceEnd: "0x700000001000",
    sizeBytes: PAGE_SIZE,
    permissions: { read: true, write: true, execute: false, private: true, shared: false },
    captured: { file: "native-memory.bin", offset: 0, sizeBytes: PAGE_SIZE },
    target: { materialization: "translate", targetStart: "0x710000000000" },
  };
  return {
    sourceArch,
    targetArch,
    mapping,
    manifest: manifest(sourceArch, targetArch),
    mappings: { formatVersion: 1, mappings: [mapping], refusals: emptyRefusals() },
    threads: threads(sourceArch, mapping.id),
    resources: resources(),
    translation: translation(sourceArch, targetArch),
    memory: memoryPage(),
  };
}

function oppositeArch(arch) {
  if (arch === "arm64") {
    return "amd64";
  }
  if (arch === "amd64") {
    return "arm64";
  }
  throw new Error(`unsupported host architecture for native restore loader: ${arch}`);
}

function emptyRefusals() {
  return { vocabularyVersion: 1, refusals: [] };
}

function manifest(sourceArch, targetArch) {
  return {
    formatVersion: 1,
    kind: "machinen.native-process-image",
    capture: { method: "external-ptrace-procfs", sourceArch, pid: 1 },
    target: { mode: "native-cross-isa", arch: targetArch, abi: "linux-user" },
    process: { exe: "/synthetic/native-loader", argv: ["native-loader"], env: {}, cwd: "/" },
    refusals: emptyRefusals(),
  };
}

function threads(sourceArch, stackMapping) {
  return {
    formatVersion: 1,
    threads: [
      {
        id: "thread:synthetic-main",
        state: "stopped",
        stopReason: "ptrace-stop",
        stackMapping,
        sourceRegisters: sourceRegisters(sourceArch),
        syscall: { state: "outside-syscall" },
        signal: { blocked: [], pending: [], activeFrame: false, altStack: { state: "disabled" } },
        tls: { threadPointer: "0x700000000800", rseq: { state: "absent" } },
      },
    ],
    refusals: emptyRefusals(),
  };
}

function sourceRegisters(arch) {
  if (arch === "arm64") {
    return {
      arch,
      pc: "0x400100",
      sp: "0x700000000f00",
      pstate: "0x0",
      x: Array.from({ length: 31 }, () => "0x0"),
    };
  }
  return {
    arch,
    rip: "0x400100",
    rsp: "0x700000000f00",
    rflags: "0x202",
    rax: "0x0",
    rbx: "0x0",
    rcx: "0x0",
    rdx: "0x0",
    rsi: "0x0",
    rdi: "0x0",
    rbp: "0x700000000f80",
    r8: "0x0",
    r9: "0x0",
    r10: "0x0",
    r11: "0x0",
    r12: "0x0",
    r13: "0x0",
    r14: "0x0",
    r15: "0x0",
    fsBase: "0x0",
    gsBase: "0x0",
  };
}

function resources() {
  return {
    formatVersion: 1,
    resources: [
      { id: "argv", kind: "argv", state: "captured", recipe: { argv: ["native-loader"] } },
      { id: "cwd", kind: "cwd", state: "recipe", path: "/", recipe: { cwd: "/" } },
      { id: "auxv", kind: "auxv", state: "captured", recipe: { bytesHex: "" } },
    ],
    refusals: emptyRefusals(),
  };
}

function translation(sourceArch, targetArch) {
  return {
    formatVersion: 1,
    mode: "native-cross-isa",
    sourceArch,
    targetArch,
    codeLocations: [],
    threads: [{ sourceThreadId: "thread:synthetic-main", state: "pending" }],
    memoryRelocations: [],
    refusals: emptyRefusals(),
  };
}

function memoryPage() {
  const page = Buffer.alloc(PAGE_SIZE);
  page.write(MARKER, 0, "utf8");
  return page;
}

function writeSyntheticBundle(bundleDir, image) {
  writeFileSync(join(bundleDir, "native-process.json"), jsonDocument(image.manifest));
  writeFileSync(join(bundleDir, "native-mappings.json"), jsonDocument(image.mappings));
  writeFileSync(join(bundleDir, "native-threads.json"), jsonDocument(image.threads));
  writeFileSync(join(bundleDir, "native-resources.json"), jsonDocument(image.resources));
  writeFileSync(join(bundleDir, "native-translation.json"), jsonDocument(image.translation));
  writeFileSync(join(bundleDir, "native-memory.bin"), image.memory);
}

function runLoader(loader, bundleDir, mapping) {
  const result = runCommand(
    loader,
    [
      "--memory",
      join(bundleDir, "native-memory.bin"),
      "--offset",
      String(mapping.captured.offset),
      "--size",
      String(mapping.captured.sizeBytes),
      "--expect-prefix",
      MARKER,
      "--final-prot",
      "r",
    ],
    { label: "native restore loader materialization" },
  );
  return parseLoaderEvent(result.stdout);
}

function parseLoaderEvent(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("MACHINEN_NATIVE_RESTORE_LOADER "));
  if (!line) {
    throw new Error("native restore loader did not emit a materialization event");
  }
  return JSON.parse(line.slice("MACHINEN_NATIVE_RESTORE_LOADER ".length));
}

function runMissingMemoryFailure(loader, bundleDir, mapping) {
  const result = spawnSync(
    loader,
    [
      "--memory",
      join(bundleDir, "missing-native-memory.bin"),
      "--offset",
      String(mapping.captured.offset),
      "--size",
      String(mapping.captured.sizeBytes),
      "--expect-prefix",
      MARKER,
      "--final-prot",
      "r",
    ],
    { encoding: "utf8" },
  );
  assert(result.status !== 0, "missing memory payload should fail materialization");
  return { status: result.status, stderr: result.stderr.trim() };
}

function validateSummary(summary) {
  assert(summary.restoreEvent.status === "materialized", "loader did not materialize mapping");
  assert(summary.restoreEvent.sizeBytes === PAGE_SIZE, "loader materialized the wrong size");
  assert(summary.restoreEvent.finalProt === "r", "loader did not apply final page protection");
  assert(
    /open memory failed/.test(summary.missingMemoryRefusal.stderr),
    "missing memory failure did not report the failing loader phase",
  );
}

function printSummary(summary, temporary) {
  console.log(
    `native-restore-loader: ${summary.hostArch} materialized ${summary.materializedMapping} (${summary.restoreEvent.sizeBytes} bytes, prot=${summary.restoreEvent.finalProt})`,
  );
  console.log(
    `native-restore-loader: missing-memory failure surfaced as '${summary.missingMemoryRefusal.stderr}'`,
  );
  if (temporary) {
    console.log("native-restore-loader: temporary artifacts removed; pass --keep to inspect them");
  }
}

main();
