#!/usr/bin/env node
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  NATIVE_CAPTURE_SOURCE,
  NATIVE_CAPTURE_TARGET_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  bundleFileStats,
  compileNativeCaptureTarget,
  compileNativeProcessCapturer,
  createProofBinAndBundleDirs,
  ensureSourcesExist,
  hostArch,
  readJson,
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
  "usage: node scripts/native-process-capture.mjs [verify] [--out-dir path] [--json] [--keep]";
function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(args, "native-process-capture", "native process capture uses Linux /proc and ptrace");
    return;
  }

  const workspace = createWorkspace(args, "machinen-native-process-capture-");
  try {
    emitResult(verifyNativeProcessCapture(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeProcessCapture(outDir) {
  ensureSourcesExist([NATIVE_CAPTURE_SOURCE, NATIVE_CAPTURE_TARGET_SOURCE]);
  const { binDir, bundleDir } = createProofBinAndBundleDirs(outDir);
  const capturer = compileNativeProcessCapturer(binDir);
  const target = compileNativeCaptureTarget(binDir);
  const resourceFile = join(outDir, "native-resource.txt");
  const sourceArch = hostArch();
  const targetArch = oppositeArch(sourceArch);

  runCommand(
    capturer,
    [
      "--output",
      bundleDir,
      "--target-arch",
      targetArch,
      "--settle-ms",
      "150",
      "--",
      target,
      "--resource-file",
      resourceFile,
    ],
    { label: "native process capture" },
  );

  const bundle = loadBundle(bundleDir);
  const summary = summarizeBundle({ bundleDir, bundle, capturer, target, sourceArch, targetArch });
  validateSummary(summary);
  return summary;
}

function oppositeArch(arch) {
  if (arch === "arm64") {
    return "amd64";
  }
  if (arch === "amd64") {
    return "arm64";
  }
  throw new Error(`unsupported host architecture for native process capture: ${arch}`);
}

function loadBundle(bundleDir) {
  return {
    manifest: readJson(join(bundleDir, "native-process.json")),
    mappings: readJson(join(bundleDir, "native-mappings.json")),
    threads: readJson(join(bundleDir, "native-threads.json")),
    resources: readJson(join(bundleDir, "native-resources.json")),
    translation: readJson(join(bundleDir, "native-translation.json")),
    memoryBytes: statSync(join(bundleDir, "native-memory.bin")).size,
  };
}

function summarizeBundle(context) {
  const fileResource = context.bundle.resources.resources.find(
    (resource) => resource.kind === "file" && resource.path?.endsWith("native-resource.txt"),
  );
  return {
    formatVersion: 1,
    hostArch: context.sourceArch,
    targetArch: context.targetArch,
    capturer: context.capturer,
    target: context.target,
    bundleDir: context.bundleDir,
    pid: context.bundle.manifest.capture.pid,
    processExe: context.bundle.manifest.process.exe,
    argv: context.bundle.manifest.process.argv,
    mappingCount: context.bundle.mappings.mappings.length,
    capturedMappingCount: context.bundle.mappings.mappings.filter((mapping) => mapping.captured)
      .length,
    mappingRefusalCount: context.bundle.mappings.refusals.refusals.length,
    threadCount: context.bundle.threads.threads.length,
    threadIds: context.bundle.threads.threads.map((thread) => thread.id),
    sourceRegisterArchs: context.bundle.threads.threads.map(
      (thread) => thread.sourceRegisters.arch,
    ),
    resourceCount: context.bundle.resources.resources.length,
    resourceKinds: [
      ...new Set(context.bundle.resources.resources.map((resource) => resource.kind)),
    ],
    fileResource: fileResource
      ? { id: fileResource.id, offset: fileResource.offset, state: fileResource.state }
      : undefined,
    translationThreadStates: context.bundle.translation.threads.map((thread) => thread.state),
    memoryBytes: context.bundle.memoryBytes,
    bundleFiles: bundleFileStats(context.bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function validateSummary(summary) {
  assert(summary.hostArch === "arm64" || summary.hostArch === "amd64", "source arch not captured");
  assert(summary.targetArch !== summary.hostArch, "target arch must be cross-ISA");
  assert(summary.pid > 0, "missing captured pid");
  assert(summary.processExe === summary.target, "process executable did not match launched target");
  assert(summary.argv.includes("--resource-file"), "argv was not captured");
  assert(summary.mappingCount > 0, "memory maps were not captured");
  assert(summary.capturedMappingCount > 0, "no readable mapping bytes were captured");
  assert(summary.threadCount >= 1, "threads were not captured");
  assert(
    summary.sourceRegisterArchs.every((arch) => arch === summary.hostArch),
    "thread register architecture mismatch",
  );
  assert(summary.resourceKinds.includes("auxv"), "auxv resource was not captured");
  assert(summary.resourceKinds.includes("file"), "file descriptor resource was not captured");
  assert(summary.fileResource?.offset === 9, "resource file offset was not captured");
  assert(
    summary.translationThreadStates.every((state) => state === "pending"),
    "capture should leave native translation pending",
  );
  assert(summary.memoryBytes > 0, "native-memory.bin is empty");
}

function printSummary(summary, temporary) {
  console.log(
    `native-process-capture: ${summary.hostArch}->${summary.targetArch} pid=${summary.pid} maps=${summary.mappingCount} captured=${summary.capturedMappingCount} threads=${summary.threadCount} resources=${summary.resourceCount}`,
  );
  console.log(
    `native-process-capture: memory=${summary.memoryBytes}B mappingRefusals=${summary.mappingRefusalCount}`,
  );
  if (temporary) {
    console.log("native-process-capture: temporary artifacts removed; pass --keep to inspect them");
  }
}

main();
