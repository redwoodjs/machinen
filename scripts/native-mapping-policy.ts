#!/usr/bin/env tsx
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { NativeMemoryMapping } from "../packages/runtime/src/native-process-image.ts";
import {
  NATIVE_CAPTURE_SOURCE,
  NATIVE_MAPPING_POLICY_TARGET_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  bundleFileStats,
  compileNativeMappingPolicyTarget,
  compileNativeProcessCapturer,
  ensureSourcesExist,
  hostArch,
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
import { validateNativeProcessImageBundle } from "../packages/runtime/src/native-process-image.ts";

const USAGE =
  "usage: tsx scripts/native-mapping-policy.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(args, "native-mapping-policy", "mapping policy capture uses Linux /proc maps");
    return;
  }
  const workspace = createWorkspace(args, "machinen-native-mapping-policy-");
  try {
    emitResult(verifyNativeMappingPolicy(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeMappingPolicy(outDir: string) {
  ensureSourcesExist([NATIVE_CAPTURE_SOURCE, NATIVE_MAPPING_POLICY_TARGET_SOURCE]);
  const binDir = join(outDir, "bin");
  const bundleDir = join(outDir, "bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });

  const capturer = compileNativeProcessCapturer(binDir);
  const target = compileNativeMappingPolicyTarget(binDir);
  runCommand(
    capturer,
    [
      "--output",
      bundleDir,
      "--target-arch",
      oppositeArch(hostArch()),
      "--settle-ms",
      "150",
      "--",
      target,
    ],
    { label: "native mapping policy capture" },
  );

  const bundle = validateNativeProcessImageBundle(bundleDir);
  const kernelMappings = bundle.mappings.mappings.filter(isKernelRecreatedMapping);
  const unreadableMappings = bundle.mappings.mappings.filter(isUnreadableRefusal);
  assert(kernelMappings.length > 0, "capture did not report kernel recreated mappings");
  assert(unreadableMappings.length > 0, "capture did not refuse the PROT_NONE mapping");
  for (const mapping of kernelMappings) {
    assert(!mapping.captured, `${mapping.id} kernel mapping unexpectedly copied source bytes`);
  }

  return {
    formatVersion: 1,
    hostArch: hostArch(),
    bundleDir,
    capturer,
    target,
    sourceArch: bundle.manifest.capture.sourceArch,
    targetArch: bundle.manifest.target.arch,
    mappingCount: bundle.mappings.mappings.length,
    kernelRecreatedMappings: kernelMappings.map(mappingSummary),
    unreadableRefusals: unreadableMappings.map(mappingSummary),
    mappingRefusals: bundle.mappings.refusals.refusals,
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function isKernelRecreatedMapping(mapping: NativeMemoryMapping) {
  return (
    (mapping.kind === "vdso" || mapping.kind === "vvar" || mapping.kind === "special") &&
    mapping.target.materialization === "recreate"
  );
}

function isUnreadableRefusal(mapping: NativeMemoryMapping) {
  return (
    !mapping.permissions.read &&
    mapping.target.materialization === "refuse" &&
    mapping.refusal?.code === "mapping-unreadable"
  );
}

function mappingSummary(mapping: NativeMemoryMapping) {
  return {
    id: mapping.id,
    kind: mapping.kind,
    sourceStart: mapping.sourceStart,
    sourceEnd: mapping.sourceEnd,
    materialization: mapping.target.materialization,
    refusalCode: mapping.refusal?.code,
    capturedBytes: mapping.captured?.sizeBytes ?? 0,
  };
}

function oppositeArch(arch: string) {
  if (arch === "arm64") {
    return "amd64";
  }
  if (arch === "amd64") {
    return "arm64";
  }
  return "unknown";
}

function printSummary(summary: ReturnType<typeof verifyNativeMappingPolicy>) {
  console.log(
    `native-mapping-policy: mappings=${summary.mappingCount} kernelRecreated=${summary.kernelRecreatedMappings.length} unreadableRefusals=${summary.unreadableRefusals.length}`,
  );
}

main();
