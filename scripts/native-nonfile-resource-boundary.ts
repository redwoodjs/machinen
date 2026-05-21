#!/usr/bin/env tsx
import { basename } from "node:path";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import type {
  NativeProcessImageDocuments,
  NativeProcessImageRefusal,
  NativeProcessResource,
  NativeProcessResourceKind,
} from "../packages/runtime/src/native-process-image.ts";
import {
  NATIVE_NONFILE_RESOURCE_BOUNDARY_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  bundleFileStats,
  compileNativeNonfileResourceBoundary,
} from "./controlled-corpus-utils.mjs";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  emitSkip,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";
import { finalJumpHex } from "./native-final-jump-utils.ts";
import { captureNativeArm64SourceBundle } from "./native-captured-source-utils.ts";

const USAGE =
  "usage: tsx scripts/native-nonfile-resource-boundary.ts [verify] [--out-dir path] [--json] [--keep]";
const RESOURCE_FILE_NAME = "native-nonfile-resource-boundary.txt";
const NONFILE_KINDS = new Set<NativeProcessResourceKind>([
  "pipe",
  "socket",
  "epoll",
  "eventfd",
  "timer",
  "pty",
]);

type NativeNonfileResourceBoundarySummary =
  | ReturnType<typeof verifyBoundary>
  | ReturnType<typeof unsupportedHostSkip>;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "native-nonfile-resource-boundary",
      "native non-file resource capture uses Linux procfs",
    );
    return;
  }
  if (process.arch !== "arm64") {
    emitSkip(
      args,
      "native-nonfile-resource-boundary",
      "native non-file resource boundary currently captures the arm64 source side",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-native-nonfile-resource-boundary-");
  try {
    emitResult(verifyBoundary(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function unsupportedHostSkip() {
  return { skipped: true, reason: `unsupported host architecture: ${process.arch}` };
}

function verifyBoundary(outDir: string) {
  const { sourceBundleDir, capturer, target, sourceBundle, facts } = captureNativeArm64SourceBundle(
    {
      outDir,
      targetSource: NATIVE_NONFILE_RESOURCE_BOUNDARY_SOURCE,
      compileTarget: compileNativeNonfileResourceBoundary,
      resourceFileName: RESOURCE_FILE_NAME,
      label: "native non-file resource boundary capture",
    },
  );
  const boundary = inspectResourceBoundary(sourceBundle, RESOURCE_FILE_NAME);
  return {
    formatVersion: 1,
    phase: "nonfile-resource-boundary",
    hostArch: "arm64",
    sourceBundleDir,
    capturer,
    target,
    pid: sourceBundle.manifest.capture.pid,
    threadId: facts.thread.id,
    capturedSourcePc: finalJumpHex(facts.sourcePc),
    capturedSourcePointer: finalJumpHex(facts.sourcePointer),
    regularFile: summarizeResource(boundary.regularFile),
    regularFileRecipe: boundary.regularFileRecipe,
    nonFileKinds: boundary.nonFileKinds,
    refusalCodes: boundary.refusals.map((refusal) => refusal.code),
    refusedResources: boundary.refusedResources.map(summarizeResource),
    unrelatedRefusals: boundary.unrelatedRefusals.map((refusal) => refusal.code),
    execution: "captured-regular-file-coexists-with-precise-nonfile-resource-refusals",
    bundleFiles: bundleFileStats(sourceBundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function inspectResourceBoundary(bundle: NativeProcessImageDocuments, resourceFileName: string) {
  const translated = translateNativeResources({ resources: bundle.resources.resources });
  const regularFile = findRegularFile(translated.resources, resourceFileName);
  assert(regularFile.recipe, "regular file resource did not keep a reopen recipe");
  const refusedResources = translated.resources.filter(
    (resource) => NONFILE_KINDS.has(resource.kind) && resource.refusal,
  );
  const nonFileKinds = [...new Set(refusedResources.map((resource) => resource.kind))].sort();
  assert(nonFileKinds.includes("pipe"), "captured resources did not include a pipe");
  assert(nonFileKinds.includes("socket"), "captured resources did not include a socket");
  assert(nonFileKinds.includes("epoll"), "captured resources did not include epoll");
  assert(nonFileKinds.includes("eventfd"), "captured resources did not include eventfd");
  assert(nonFileKinds.includes("timer"), "captured resources did not include timerfd");
  const refusals = refusedResources.map((resource) => resource.refusal).filter(isRefusal);
  for (const refusal of refusals) {
    assert(
      refusal.code === "kernel-state-unsupported" || refusal.code === "resource-kind-unsupported",
      `unexpected non-file refusal code ${refusal.code}`,
    );
  }
  const unrelatedRefusals = translated.refusals.filter(
    (refusal) => !refusals.some((candidate) => candidate === refusal),
  );
  return {
    regularFile,
    regularFileRecipe: regularFile.recipe,
    refusedResources,
    nonFileKinds,
    refusals,
    unrelatedRefusals,
  };
}

function findRegularFile(resources: NativeProcessResource[], resourceFileName: string) {
  const regularFile = resources.find(
    (resource) =>
      resource.kind === "file" && resource.path && basename(resource.path) === resourceFileName,
  );
  assert(regularFile, `captured resources did not include ${resourceFileName}`);
  assert(regularFile.state === "recipe", "regular file resource was not translated to a recipe");
  return regularFile;
}

function summarizeResource(resource: NativeProcessResource) {
  return {
    id: resource.id,
    kind: resource.kind,
    state: resource.state,
    fd: resource.fd,
    path: resource.path,
    refusalCode: resource.refusal?.code,
  };
}

function isRefusal(
  value: NativeProcessImageRefusal | undefined,
): value is NativeProcessImageRefusal {
  return value !== undefined;
}

function printSummary(summary: NativeNonfileResourceBoundarySummary) {
  if ("skipped" in summary) {
    console.log(`native-nonfile-resource-boundary: skip — ${summary.reason}`);
    return;
  }
  console.log(
    `native-nonfile-resource-boundary: file=${summary.regularFile.fd} nonfile=${summary.nonFileKinds.join(",")}`,
  );
  console.log(`native-nonfile-resource-boundary: execution=${summary.execution}`);
}

main();
