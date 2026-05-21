#!/usr/bin/env tsx
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { classifyNativeActiveSyscalls } from "../packages/runtime/src/native-active-syscall-policy.ts";
import { planNativeMappingMaterialization } from "../packages/runtime/src/native-mapping-materialization.ts";
import { inventoryNativeActualTargetModules } from "../packages/runtime/src/native-actual-target-module-inventory.ts";
import {
  inventoryNativeSourceCodeModules,
  resolveNativeRealUtilityCodeLocations,
} from "../packages/runtime/src/native-real-utility-code-map.ts";
import { planNativeActualRealUtilityContinuationAttempt } from "../packages/runtime/src/native-actual-real-utility-continuation.ts";
import { materializeNativeTargetModuleBytes } from "../packages/runtime/src/native-target-module-bytes.ts";
import {
  validateNativeProcessImageBundle,
  type NativeThreadState,
} from "../packages/runtime/src/native-process-image.ts";
import { translateNativeRegisterState } from "../packages/runtime/src/native-register-translation.ts";
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
} from "./proof-script-utils.mjs";
import {
  FINAL_JUMP_TARGET_ENTRY,
  FINAL_JUMP_TARGET_STACK_POINTER,
  finalJumpHex,
} from "./native-final-jump-utils.ts";
import { spawnSync } from "node:child_process";

const USAGE =
  "usage: tsx scripts/native-actual-real-utility-continuation.ts [verify] [--out-dir path] [--json] [--keep]";
const SOURCE_BUNDLE_ENV = "MACHINEN_ACTUAL_REAL_UTILITY_SOURCE_BUNDLE";
const TARGET_ROOT_ENV = "MACHINEN_ACTUAL_REAL_UTILITY_TARGET_ROOT";
const TARGET_MODULE_PATH_ENV = "MACHINEN_ACTUAL_REAL_UTILITY_TARGET_MODULE";
const SLEEP_SYSCALL_POLICY_ENV = "MACHINEN_ACTUAL_REAL_UTILITY_SLEEP_SYSCALL_POLICY";
const UTILITY_NAME = "sleep";
const SETTLE_MS = "150";
const TARGET_BYTE_WINDOW = 32;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "native-actual-real-utility-continuation",
      "actual real utility capture uses Linux ptrace/procfs",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-native-actual-real-utility-continuation-");
  try {
    emitResult(
      verifyActualRealUtilityContinuation(workspace.outDir),
      args,
      workspace,
      printSummary,
    );
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyActualRealUtilityContinuation(outDir: string) {
  if (process.arch === "arm64") {
    return captureArm64ActualUtility(outDir);
  }
  if (process.arch === "x64") {
    const sourceBundle = process.env[SOURCE_BUNDLE_ENV];
    if (!sourceBundle) {
      return {
        skipped: true,
        reason: `${SOURCE_BUNDLE_ENV} must point at an arm64 real-utility bundle on Linux/amd64`,
      };
    }
    return consumeAmd64ActualUtility(outDir, resolve(sourceBundle));
  }
  return { skipped: true, reason: `unsupported host architecture: ${process.arch}` };
}

function captureArm64ActualUtility(outDir: string) {
  ensureSourcesExist([NATIVE_CAPTURE_SOURCE]);
  const binDir = join(outDir, "bin");
  const bundleDir = join(outDir, "actual-real-utility-source-bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });
  const capturer = compileNativeProcessCapturer(binDir);
  const utility = requireUtility(["/bin/sleep", "/usr/bin/sleep"]);
  const command = [utility, "30"];
  const capture = spawnSync(
    capturer,
    ["--output", bundleDir, "--target-arch", "amd64", "--settle-ms", SETTLE_MS, "--", ...command],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (capture.status !== 0) {
    return {
      formatVersion: 1,
      phase: "actual-real-utility-capture",
      hostArch: hostArch(),
      targetArch: "amd64",
      sourceBundleDir: bundleDir,
      capturer,
      utility: { name: UTILITY_NAME, command },
      processImageValidated: false,
      plan: refusedCapturePlan(capture.stderr.trim()),
      blockingBoundary: "capture" as const,
      blockingRefusal: refusedCapturePlan(capture.stderr.trim()).blockingRefusal,
      attemptedResume: false,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      execution: "actual-arm64-real-utility-refused-at-capture",
    };
  }

  const planned = planCapturedActualUtilityBundle(bundleDir, { targetRoot: undefined });
  assert(
    planned.bundle.manifest.capture.sourceArch === "arm64",
    "actual source bundle was not arm64",
  );
  return actualUtilitySummary({
    phase: "actual-real-utility-capture",
    hostArch: "arm64",
    sourceBundleDir: bundleDir,
    capturer,
    command,
    planned,
  });
}

function consumeAmd64ActualUtility(outDir: string, sourceBundleDir: string) {
  const targetRoot = process.env[TARGET_ROOT_ENV] ?? "/";
  const planned = planCapturedActualUtilityBundle(sourceBundleDir, {
    targetRoot,
    explicitTargetModulePath: process.env[TARGET_MODULE_PATH_ENV],
  });
  assert(planned.bundle.manifest.capture.sourceArch === "arm64", "source bundle must be arm64");
  assert(planned.bundle.manifest.target.arch === "amd64", "source bundle target must be amd64");
  return actualUtilitySummary({
    phase: "actual-real-utility-target-plan",
    hostArch: "amd64",
    sourceBundleDir,
    targetRoot,
    command: planned.bundle.manifest.process.argv,
    planned,
    outDir,
  });
}

function planCapturedActualUtilityBundle(
  bundleDir: string,
  options: { targetRoot?: string; explicitTargetModulePath?: string },
) {
  const bundle = validateNativeProcessImageBundle(bundleDir);
  const memoryBytes = statSync(join(bundleDir, "native-memory.bin")).size;
  const activeSyscalls = classifyNativeActiveSyscalls(bundle.threads.threads, {
    sleepTimerPolicy: sleepTimerPolicy(),
  });
  const registers = translateNativeRegisterState({
    sourceArch: bundle.manifest.capture.sourceArch,
    targetArch: bundle.manifest.target.arch,
    threads: bundle.threads.threads,
    continuations: Object.fromEntries(
      bundle.threads.threads.map((thread) => [thread.id, placeholderContinuation(thread)]),
    ),
  });
  const resources = translateNativeResources({
    resources: bundle.resources.resources,
    inheritedStdio: { mode: "inherit-output" },
  });
  const mappings = planNativeMappingMaterialization({
    mappings: bundle.mappings.mappings,
    memorySizeBytes: memoryBytes,
  });
  const sourceModules = inventoryNativeSourceCodeModules(bundle);
  const { targetModules } = inventoryNativeActualTargetModules({
    sourceModules,
    targetArch: "amd64",
    targetRoot: options.targetRoot,
    explicitTargetModulePath: options.explicitTargetModulePath,
  });
  const code = resolveNativeRealUtilityCodeLocations({
    documents: bundle,
    targetArch: "amd64",
    targetModules,
    activeSyscallContinuations: activeSyscalls.continuations,
  });
  const targetBytes = materializeResolvedTargetBytes(code.resolved, options.targetRoot);
  const plan = planNativeActualRealUtilityContinuationAttempt({
    threadRefusals: effectiveThreadRefusals({ activeSyscalls, registers }),
    resourceRefusals: resources.refusals,
    mappingRefusals: mappings.refusals,
    codeLocations: code.codeLocations,
    sourceFrames: [],
    targetModuleByteRefusals: targetBytes.refusals,
    targetModuleBytesMaterialized: targetBytes.materialized.length > 0,
  });
  return {
    bundle,
    memoryBytes,
    activeSyscalls,
    registers,
    resources,
    mappings,
    sourceModules,
    targetModules,
    code,
    sourceFrames: [],
    targetUnwind: undefined,
    targetBytes,
    plan,
  };
}

function placeholderContinuation(thread: NativeThreadState) {
  return {
    sourcePc: threadPc(thread),
    targetIp: finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    targetSp: finalJumpHex(FINAL_JUMP_TARGET_STACK_POINTER),
    targetTls: "0x0",
  };
}

function threadPc(thread: NativeThreadState): string {
  return thread.sourceRegisters.arch === "arm64"
    ? thread.sourceRegisters.pc
    : thread.sourceRegisters.rip;
}

function materializeResolvedTargetBytes(
  resolved: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"],
  targetRoot: string | undefined,
) {
  const materialized = [];
  const refusals = [];
  for (const location of resolved) {
    const bytes = materializeNativeTargetModuleBytes({
      module: location.targetModule,
      targetRoot,
      relativeStart: location.sourceRva,
      sizeBytes: TARGET_BYTE_WINDOW,
    });
    if (bytes.materialized) {
      materialized.push(bytes.materialized);
    }
    refusals.push(...bytes.refusals);
  }
  return { materialized, refusals };
}

function actualUtilitySummary(context: {
  phase: string;
  hostArch: "arm64" | "amd64";
  sourceBundleDir: string;
  targetRoot?: string;
  capturer?: string;
  command: string[];
  outDir?: string;
  planned: ReturnType<typeof planCapturedActualUtilityBundle>;
}) {
  const { planned } = context;
  return {
    formatVersion: 1,
    phase: context.phase,
    hostArch: context.hostArch,
    targetArch: "amd64",
    sourceBundleDir: context.sourceBundleDir,
    targetRoot: context.targetRoot,
    capturer: context.capturer,
    utility: utilitySummary(context),
    processImageValidated: true,
    actualCapturedUtility: true,
    activeSyscallPolicy: { sleepTimerPolicy: sleepTimerPolicy() },
    threadSyscalls: threadSyscallSummaries(planned),
    activeSyscallClassifications: planned.activeSyscalls.classifications,
    threadRefusals: effectiveThreadRefusals(planned),
    registerRefusals: planned.registers.refusals,
    resourceRefusals: planned.resources.refusals,
    mappingRefusals: planned.mappings.refusals,
    codeLocationRefusals: planned.code.refusals,
    deferredActiveSyscallLandings: deferredActiveSyscallLandingSummaries(planned),
    sourceUnwindFrames: planned.sourceFrames.length,
    targetUnwindMatches: planned.targetUnwind?.matches.length ?? 0,
    targetModuleByteRefusals: planned.targetBytes.refusals,
    materializedTargetBytes: materializedTargetByteSummaries(planned),
    sourceModules: planned.sourceModules.length,
    targetModules: targetModuleSummaries(planned),
    mappingSteps: planned.mappings.steps.length,
    resourceRecipes: resourceRecipeCount(planned),
    plan: planned.plan,
    blockingBoundary: planned.plan.blockingBoundary,
    blockingRefusal: planned.plan.blockingRefusal,
    attemptedResume: false,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
    execution: executionForPlan(planned),
    bundleFiles: bundleFileStats(context.sourceBundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function utilitySummary(context: {
  command: string[];
  planned: ReturnType<typeof planCapturedActualUtilityBundle>;
}) {
  return {
    name: basename(context.command[0] ?? UTILITY_NAME),
    command: context.command,
    executable: context.planned.bundle.manifest.process.exe,
    pid: context.planned.bundle.manifest.capture.pid,
  };
}

function threadSyscallSummaries(planned: ReturnType<typeof planCapturedActualUtilityBundle>) {
  return planned.bundle.threads.threads.map((thread) => ({
    id: thread.id,
    state: thread.syscall.state,
    number: thread.syscall.number,
    name: thread.syscall.name,
  }));
}

function effectiveThreadRefusals(
  planned: Pick<ReturnType<typeof planCapturedActualUtilityBundle>, "activeSyscalls" | "registers">,
) {
  if (planned.activeSyscalls.refusals.length > 0) {
    return planned.activeSyscalls.refusals;
  }
  if (planned.activeSyscalls.continuations.length > 0) {
    return planned.registers.refusals.filter((refusal) => refusal.code !== "active-syscall");
  }
  return planned.registers.refusals;
}

function deferredActiveSyscallLandingSummaries(
  planned: ReturnType<typeof planCapturedActualUtilityBundle>,
) {
  return planned.code.resolved.flatMap((location) => {
    const landing = location.deferredActiveSyscallLanding;
    return landing
      ? [
          {
            threadId: landing.threadId,
            syscallClass: landing.syscallClass,
            action: landing.action,
            sourceAddress: landing.sourceAddress,
            targetAddress: landing.targetAddress,
            remainingTime: landing.metadata.remainingTime,
          },
        ]
      : [];
  });
}

function materializedTargetByteSummaries(
  planned: ReturnType<typeof planCapturedActualUtilityBundle>,
) {
  return planned.targetBytes.materialized.map((bytes) => ({
    moduleId: bytes.moduleId,
    relativeStart: bytes.relativeStart,
    sizeBytes: bytes.sizeBytes,
    sourceTextReusedAsTargetCode: bytes.sourceTextReusedAsTargetCode,
  }));
}

function targetModuleSummaries(planned: ReturnType<typeof planCapturedActualUtilityBundle>) {
  return planned.targetModules.map((module) => ({
    id: module.id,
    logicalName: module.logicalName,
    path: module.path,
    buildId: module.buildId,
  }));
}

function resourceRecipeCount(planned: ReturnType<typeof planCapturedActualUtilityBundle>) {
  return planned.resources.resources.filter((resource) => resource.state === "recipe").length;
}

function executionForPlan(planned: ReturnType<typeof planCapturedActualUtilityBundle>) {
  return planned.plan.state === "ready"
    ? "actual-real-utility-ready-for-target-native-resume"
    : `actual-real-utility-refused-at-${planned.plan.blockingBoundary}`;
}

function sleepTimerPolicy() {
  return process.env[SLEEP_SYSCALL_POLICY_ENV] === "defer-target-resume"
    ? "defer-target-resume"
    : "refuse";
}

function refusedCapturePlan(stderr: string) {
  return {
    state: "refused" as const,
    blockingBoundary: "capture" as const,
    blockingRefusal: {
      code: "thread-state-unsupported" as const,
      message: "external live capture failed for actual real utility",
      detail: { stderr },
    },
    attemptedResume: false,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
  };
}

function requireUtility(paths: string[]) {
  const utility = paths.find((path) => existsSync(path));
  assert(utility, `${UTILITY_NAME} utility not found`);
  return utility;
}

function printSummary(
  summary:
    | ReturnType<typeof verifyActualRealUtilityContinuation>
    | { skipped: true; reason: string },
) {
  if ("skipped" in summary) {
    console.log(`native-actual-real-utility-continuation: skipped ${summary.reason}`);
    return;
  }
  console.log(
    `native-actual-real-utility-continuation: execution=${summary.execution} boundary=${summary.blockingBoundary}`,
  );
}

main();
