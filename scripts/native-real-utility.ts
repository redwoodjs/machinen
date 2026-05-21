#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { planNativeMappingMaterialization } from "../packages/runtime/src/native-mapping-materialization.ts";
import {
  validateNativeProcessImageBundle,
  type NativeProcessImageRefusal,
} from "../packages/runtime/src/native-process-image.ts";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import {
  NATIVE_CAPTURE_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  bundleFileStats,
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

const USAGE =
  "usage: tsx scripts/native-real-utility.ts [verify] [--out-dir path] [--json] [--keep]";
const UTILITY_NAME = "sleep";
const SETTLE_MS = "150";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(args, "native-real-utility", "real utility continuation attempt uses Linux procfs");
    return;
  }
  if (process.arch !== "arm64") {
    emitSkip(
      args,
      "native-real-utility",
      "real utility continuation attempt currently captures an arm64 Linux source utility",
    );
    return;
  }
  const workspace = createWorkspace(args, "machinen-native-real-utility-");
  try {
    emitResult(verifyRealUtilityContinuation(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyRealUtilityContinuation(outDir: string) {
  ensureSourcesExist([NATIVE_CAPTURE_SOURCE]);
  const binDir = join(outDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const capturer = compileNativeProcessCapturer(binDir);
  const utility = requireUtility(["/bin/sleep", "/usr/bin/sleep"]);
  const dynamicLinking = inspectDynamicLinking(utility);
  const attempt = attemptSleepContinuation(outDir, capturer, utility, dynamicLinking);
  return {
    formatVersion: 1,
    hostArch: hostArch(),
    targetArch: "amd64",
    capturer,
    utility: attempt,
  };
}

function attemptSleepContinuation(
  outDir: string,
  capturer: string,
  utility: string,
  dynamicLinking: ReturnType<typeof inspectDynamicLinking>,
) {
  const bundleDir = join(outDir, "sleep-source-bundle");
  mkdirSync(bundleDir, { recursive: true });
  const command = [utility, "30"];
  const capture = spawnSync(
    capturer,
    ["--output", bundleDir, "--target-arch", "amd64", "--settle-ms", SETTLE_MS, "--", ...command],
    {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (capture.status !== 0) {
    return refusedUtility(command, "thread-state-unsupported", "external live capture failed", {
      stderr: capture.stderr.trim(),
    });
  }

  const bundle = validateNativeProcessImageBundle(bundleDir);
  assert(
    bundle.manifest.capture.sourceArch === "arm64",
    "real utility source capture was not arm64",
  );
  assert(bundle.manifest.target.arch === "amd64", "real utility target arch was not amd64");
  const resources = translateNativeResources({ resources: bundle.resources.resources });
  const memoryBytes = statSync(join(bundleDir, "native-memory.bin")).size;
  const mappings = planNativeMappingMaterialization({
    mappings: bundle.mappings.mappings,
    memorySizeBytes: memoryBytes,
  });
  const blocking = firstBlockingBoundary(resources.refusals, mappings.refusals);
  const codeBoundary = blocking ?? codeLocationBoundary(bundle.manifest.process.exe);
  return {
    name: UTILITY_NAME,
    state: "refused" as const,
    command,
    pid: bundle.manifest.capture.pid,
    executable: bundle.manifest.process.exe,
    dynamicallyLinked: dynamicLinking.dynamicallyLinked,
    interpreter: dynamicLinking.interpreter,
    processImageValidated: true,
    mappingSteps: mappings.steps.length,
    mappingRefusals: mappings.refusals,
    threadCount: bundle.threads.threads.length,
    mappingCount: bundle.mappings.mappings.length,
    resourceKinds: [...new Set(bundle.resources.resources.map((resource) => resource.kind))].sort(),
    resourceRefusals: resources.refusals,
    blockingBoundary: codeBoundary.boundary,
    blockingRefusal: codeBoundary.refusal,
    attemptedResume: false,
    sourceTextReusedAsTargetCode: false,
    targetBinarySource: "not-provided",
    execution: `real-arm64-${UTILITY_NAME}-refused-at-${codeBoundary.boundary}`,
    bundleFiles: bundleFileStats(bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function firstBlockingBoundary(
  resourceRefusals: NativeProcessImageRefusal[],
  mappingRefusals: NativeProcessImageRefusal[],
) {
  const resource = resourceRefusals[0];
  if (resource) {
    return { boundary: "resource-boundary" as const, refusal: resource };
  }
  const mapping = mappingRefusals[0];
  if (mapping) {
    return { boundary: "mapping-materialization" as const, refusal: mapping };
  }
  return undefined;
}

function codeLocationBoundary(executable: string) {
  return {
    boundary: "target-code-location" as const,
    refusal: {
      code: "code-location-unknown" as const,
      message:
        "real utility continuation has no matching amd64 target module/RVA and will not reuse arm64 source text",
      detail: {
        executable,
        required: ["matching target binary", "module/RVA code map", "unwind-derived landing"],
      },
    },
  };
}

function refusedUtility(
  command: string[],
  code: NativeProcessImageRefusal["code"],
  message: string,
  detail: Record<string, unknown>,
) {
  return {
    name: UTILITY_NAME,
    state: "refused" as const,
    command,
    processImageValidated: false,
    blockingBoundary: "capture" as const,
    blockingRefusal: { code, message, detail },
    attemptedResume: false,
    sourceTextReusedAsTargetCode: false,
    execution: `real-arm64-${UTILITY_NAME}-refused-at-capture`,
  };
}

function requireUtility(paths: string[]) {
  const utility = paths.find((path) => existsSync(path));
  assert(utility, `${UTILITY_NAME} utility not found`);
  return utility;
}

function inspectDynamicLinking(path: string) {
  const programHeaders = runCommand("readelf", ["-l", path], {
    label: "real utility ELF scan",
  }).stdout;
  const dynamic = runCommand("readelf", ["-d", path], { label: "real utility dynamic scan" });
  const interpreter = /Requesting program interpreter:\s*([^\]]+)/.exec(programHeaders)?.[1];
  const dynamicallyLinked = programHeaders.includes("INTERP") && dynamic.status === 0;
  assert(dynamicallyLinked, `${path} is not a dynamically linked ELF utility`);
  return { dynamicallyLinked, interpreter: interpreter?.trim() ?? "unknown" };
}

function printSummary(summary: ReturnType<typeof verifyRealUtilityContinuation>) {
  const attempt = summary.utility;
  console.log(
    `native-real-utility: ${attempt.name} state=${attempt.state} boundary=${attempt.blockingBoundary} refusal=${attempt.blockingRefusal.code}`,
  );
  console.log(`native-real-utility: execution=${attempt.execution}`);
}

main();
