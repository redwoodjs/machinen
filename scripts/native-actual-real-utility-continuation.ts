#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { classifyNativeActiveSyscalls } from "../packages/runtime/src/native-active-syscall-policy.ts";
import { planNativeMappingMaterialization } from "../packages/runtime/src/native-mapping-materialization.ts";
import { inventoryNativeActualTargetModules } from "../packages/runtime/src/native-actual-target-module-inventory.ts";
import {
  inventoryNativeSourceCodeModules,
  resolveNativeRealUtilityCodeLocations,
} from "../packages/runtime/src/native-real-utility-code-map.ts";
import { planNativeActualRealUtilityContinuationAttempt } from "../packages/runtime/src/native-actual-real-utility-continuation.ts";
import { materializeNativeTargetModuleBytes } from "../packages/runtime/src/native-target-module-bytes.ts";
import { planNativeTargetFrameStateMaterialization } from "../packages/runtime/src/native-target-frame-state.ts";
import { planNativeSyntheticTargetCallerFrame } from "../packages/runtime/src/native-target-caller-frame.ts";
import {
  matchNativeTargetUnwindFrame,
  parseNativeTargetEhFrameText,
  type NativeTargetUnwindMatchResult,
} from "../packages/runtime/src/native-target-unwind.ts";
import {
  discoverNativeUnwindFrames,
  nativeUnwindReturnAddressSlot,
  parseNativeEhFrameText,
  type NativeDiscoveredUnwindFrame,
  type NativeUnwindFrameRule,
} from "../packages/runtime/src/native-unwind-frames.ts";
import {
  validateNativeProcessImageBundle,
  type NativeArm64Registers,
  type NativeMemoryMapping,
  type NativeProcessImageDocuments,
  type NativeProcessImageRefusal,
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
  runCommand,
} from "./proof-script-utils.mjs";
import {
  FINAL_JUMP_TARGET_ENTRY,
  FINAL_JUMP_TARGET_STACK_POINTER,
  finalJumpHex,
} from "./native-final-jump-utils.ts";
import { readCapturedU64 } from "./native-captured-source-utils.ts";
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
const SOURCE_UNWIND_FILE = "native-source-unwind.json";

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

  writeActualSourceUnwindSidecar(bundleDir);
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
  const inputs = actualUtilityPlanningInputs(bundleDir, options);
  const plan = planNativeActualRealUtilityContinuationAttempt({
    threadRefusals: effectiveThreadRefusals(inputs),
    resourceRefusals: inputs.resources.refusals,
    mappingRefusals: inputs.mappings.refusals,
    codeLocations: inputs.code.codeLocations,
    sourceFrames: inputs.sourceUnwind.frames,
    sourceFrameRefusals: inputs.sourceUnwind.refusals,
    targetUnwind: inputs.targetUnwind,
    targetFrameState: inputs.targetFrameState,
    targetModuleByteRefusals: inputs.targetBytes.refusals,
    targetCallerFrameRefusals: inputs.targetCallerFrame.refusals,
    targetCallerFrameMaterialized: inputs.targetCallerFrame.state === "planned",
    targetModuleBytesMaterialized: inputs.targetBytes.materialized.length > 0,
  });
  return {
    ...inputs,
    sourceFrames: inputs.sourceUnwind.frames,
    sourceUnwindRefusals: inputs.sourceUnwind.refusals,
    sourceUnwindRules: inputs.sourceUnwind.rules,
    targetUnwind: inputs.targetUnwind,
    plan,
  };
}

function actualUtilityPlanningInputs(
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
  const sourceUnwind = readActualSourceUnwindSidecar(bundleDir);
  const targetUnwind = discoverActualTargetUnwind({
    resolved: code.resolved,
    sourceFrames: sourceUnwind.frames,
    targetRoot: options.targetRoot,
  });
  const targetFrameState = planNativeTargetFrameStateMaterialization({
    targetUnwind,
    syntheticTargetCaller: { mode: "abi-neutral-sentinel" },
  });
  const targetCallerFrame = planNativeSyntheticTargetCallerFrame({
    frameState: targetFrameState,
    policy: { mode: "abi-neutral-sentinel" },
  });
  const targetBytes = materializeResolvedTargetBytes(code.resolved, options.targetRoot);
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
    sourceUnwind,
    targetUnwind,
    targetFrameState,
    targetCallerFrame,
    targetBytes,
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

interface ActualSourceUnwindSidecar {
  formatVersion: 1;
  rules: NativeUnwindFrameRule[];
  frames: NativeDiscoveredUnwindFrame[];
  refusals: NativeProcessImageRefusal[];
}

function writeActualSourceUnwindSidecar(bundleDir: string) {
  const bundle = validateNativeProcessImageBundle(bundleDir);
  const sidecar = discoverActualSourceUnwind(bundle);
  writeFileSync(join(bundleDir, SOURCE_UNWIND_FILE), `${JSON.stringify(sidecar, null, 2)}\n`);
}

function readActualSourceUnwindSidecar(bundleDir: string): ActualSourceUnwindSidecar {
  const path = join(bundleDir, SOURCE_UNWIND_FILE);
  return existsSync(path)
    ? normalizeActualSourceUnwindSidecar(JSON.parse(readFileSync(path, "utf8")))
    : emptyActualSourceUnwindSidecar();
}

function normalizeActualSourceUnwindSidecar(value: unknown): ActualSourceUnwindSidecar {
  const parsed = value as Partial<ActualSourceUnwindSidecar>;
  return {
    formatVersion: 1,
    rules: parsed.rules ?? [],
    frames: parsed.frames ?? [],
    refusals: parsed.refusals ?? [],
  };
}

function emptyActualSourceUnwindSidecar(): ActualSourceUnwindSidecar {
  return { formatVersion: 1, rules: [], frames: [], refusals: [] };
}

function discoverActualSourceUnwind(
  bundle: NativeProcessImageDocuments,
): ActualSourceUnwindSidecar {
  const rules: NativeUnwindFrameRule[] = [];
  const frames: NativeDiscoveredUnwindFrame[] = [];
  const refusals: NativeProcessImageRefusal[] = [];

  for (const thread of bundle.threads.threads) {
    const discovered = discoverActualThreadSourceUnwind(bundle, thread);
    rules.push(...discovered.rules);
    frames.push(...discovered.frames);
    refusals.push(...discovered.refusals);
  }

  return { formatVersion: 1, rules, frames, refusals };
}

function discoverActualThreadSourceUnwind(
  bundle: NativeProcessImageDocuments,
  thread: NativeThreadState,
): Omit<ActualSourceUnwindSidecar, "formatVersion"> {
  const input = actualThreadUnwindInput(bundle, thread);
  if ("refusals" in input) {
    return emptyThreadSourceUnwind(input.refusals);
  }
  return sourceUnwindFromParsedRule(
    bundle,
    input.thread,
    parseActualSourceUnwindRule(input.mapping, input.thread),
  );
}

function actualThreadUnwindInput(
  bundle: NativeProcessImageDocuments,
  thread: NativeThreadState,
):
  | {
      thread: NativeThreadState & { sourceRegisters: NativeArm64Registers };
      mapping: NativeMemoryMapping & { file: { path: string; offset: number } };
    }
  | { refusals: NativeProcessImageRefusal[] } {
  const arm64Thread = arm64UnwindThread(thread);
  if ("refusals" in arm64Thread) {
    return arm64Thread;
  }
  const mapping = sourceUnwindMapping(bundle, arm64Thread.thread);
  return "refusals" in mapping ? mapping : { thread: arm64Thread.thread, mapping: mapping.mapping };
}

function sourceUnwindFromParsedRule(
  bundle: NativeProcessImageDocuments,
  thread: NativeThreadState & { sourceRegisters: NativeArm64Registers },
  parsed: ReturnType<typeof parseNativeEhFrameText>,
): Omit<ActualSourceUnwindSidecar, "formatVersion"> {
  if (parsed.refusals.length > 0) {
    return emptyThreadSourceUnwind(parsed.refusals);
  }
  const rule = parsed.rules[0];
  if (!rule) {
    return emptyThreadSourceUnwind([sourceUnwindRefusal("unwind-fde-missing")]);
  }
  const discovered = discoverFrameFromActualRule(bundle, thread, rule);
  return { rules: [rule], frames: discovered.frames, refusals: discovered.refusals };
}

function emptyThreadSourceUnwind(
  refusals: NativeProcessImageRefusal[],
): Omit<ActualSourceUnwindSidecar, "formatVersion"> {
  return { rules: [], frames: [], refusals };
}

function arm64UnwindThread(
  thread: NativeThreadState,
):
  | { thread: NativeThreadState & { sourceRegisters: NativeArm64Registers } }
  | { refusals: NativeProcessImageRefusal[] } {
  if (thread.sourceRegisters.arch === "arm64") {
    return { thread: thread as NativeThreadState & { sourceRegisters: NativeArm64Registers } };
  }
  return { refusals: [sourceUnwindRefusal("architecture-unsupported")] };
}

function sourceUnwindMapping(
  bundle: NativeProcessImageDocuments,
  thread: NativeThreadState & { sourceRegisters: NativeArm64Registers },
):
  | { mapping: NativeMemoryMapping & { file: { path: string; offset: number } } }
  | {
      refusals: NativeProcessImageRefusal[];
    } {
  const pc = BigInt(thread.sourceRegisters.pc);
  const mapping = executableMappingForPc(bundle, pc);
  if (!mapping?.file?.path) {
    return {
      refusals: [
        sourceUnwindRefusal(
          "unwind-metadata-missing",
          `thread ${thread.id} pc ${thread.sourceRegisters.pc} has no executable file mapping for .eh_frame discovery`,
        ),
      ],
    };
  }
  if (!existsSync(mapping.file.path)) {
    return {
      refusals: [
        sourceUnwindRefusal(
          "unwind-metadata-missing",
          `source module is unavailable for .eh_frame discovery: ${mapping.file.path}`,
        ),
      ],
    };
  }
  return { mapping: mapping as NativeMemoryMapping & { file: { path: string; offset: number } } };
}

function parseActualSourceUnwindRule(
  mapping: NativeMemoryMapping & { file: { path: string; offset: number } },
  thread: NativeThreadState & { sourceRegisters: NativeArm64Registers },
) {
  const loadBias = finalJumpHex(BigInt(mapping.sourceStart) - BigInt(mapping.file.offset));
  const readelfFrames = runCommand("readelf", ["--debug-dump=frames", mapping.file.path], {
    label: `actual source .eh_frame scan ${basename(mapping.file.path)}`,
  }).stdout;
  return parseNativeEhFrameText({
    readelfFrames,
    mapping: mapping.id,
    functionName: basename(mapping.file.path),
    pc: thread.sourceRegisters.pc,
    loadBias,
  });
}

function sourceUnwindRefusal(
  code: NativeProcessImageRefusal["code"],
  message = "source unwind metadata is unavailable for actual utility frame",
): NativeProcessImageRefusal {
  return { code, message };
}

function discoverFrameFromActualRule(
  bundle: NativeProcessImageDocuments,
  thread: NativeThreadState & { sourceRegisters: NativeArm64Registers },
  rule: NativeUnwindFrameRule,
) {
  const returnAddressSlot = nativeUnwindReturnAddressSlot({
    rule,
    sourceRegisters: thread.sourceRegisters,
  });
  if (!returnAddressSlot) {
    return {
      frames: [],
      refusals: [
        {
          code: "unwind-rule-unsupported" as const,
          message: `source unwind rule ${rule.id} does not expose a return-address slot`,
        },
      ],
    };
  }

  const stackMapping = mappingById(bundle, thread.stackMapping);
  const returnAddress = readCapturedU64(bundle, stackMapping, BigInt(returnAddressSlot));
  return discoverNativeUnwindFrames({
    threadId: thread.id,
    stackMapping: thread.stackMapping,
    sourceRegisters: thread.sourceRegisters,
    rules: [rule],
    stackWords: [{ address: returnAddressSlot, value: finalJumpHex(returnAddress) }],
  });
}

function executableMappingForPc(bundle: NativeProcessImageDocuments, pc: bigint) {
  return bundle.mappings.mappings.find(
    (mapping) =>
      mapping.permissions.execute &&
      pc >= BigInt(mapping.sourceStart) &&
      pc < BigInt(mapping.sourceEnd),
  );
}

function mappingById(bundle: NativeProcessImageDocuments, id: string): NativeMemoryMapping {
  const mapping = bundle.mappings.mappings.find((candidate) => candidate.id === id);
  assert(mapping, `source bundle references missing mapping ${id}`);
  return mapping;
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

function discoverActualTargetUnwind(options: {
  resolved: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"];
  sourceFrames: NativeDiscoveredUnwindFrame[];
  targetRoot?: string;
}): NativeTargetUnwindMatchResult {
  const result: NativeTargetUnwindMatchResult = { matches: [], refusals: [] };
  for (const location of options.resolved) {
    const matched = discoverActualTargetUnwindForLocation(
      location,
      options.sourceFrames,
      options.targetRoot,
    );
    result.matches.push(...matched.matches);
    result.refusals.push(...matched.refusals);
  }
  return result;
}

function discoverActualTargetUnwindForLocation(
  location: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"][number],
  sourceFrames: NativeDiscoveredUnwindFrame[],
  targetRoot: string | undefined,
): NativeTargetUnwindMatchResult {
  const sourceFrame = sourceFrameForTargetLocation(
    sourceFrames,
    location.threadId,
    location.codeLocation.sourceAddress,
  );
  if (!sourceFrame) {
    return targetUnwindRefused(
      "target-unwind-mismatch",
      `no source unwind frame matches target location ${location.codeLocation.id}`,
    );
  }
  const targetPath = resolveActualTargetPath(targetRoot, location.targetModule.path);
  if (!existsSync(targetPath)) {
    return targetUnwindRefused(
      "target-module-file-missing",
      `target module file is unavailable for .eh_frame discovery: ${location.targetModule.path}`,
    );
  }
  const parsed = parseTargetUnwindForLocation(location, targetPath);
  if (parsed.refusals.length > 0) {
    return { matches: [], refusals: parsed.refusals };
  }
  return matchNativeTargetUnwindFrame({
    sourceFrame,
    targetAddress: location.targetAddress,
    targetRules: parsed.rules,
    calleeSavedPolicy: "record",
  });
}

function parseTargetUnwindForLocation(
  location: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"][number],
  targetPath: string,
) {
  const readelfFrames = runCommand("readelf", ["--debug-dump=frames", targetPath], {
    label: `actual target .eh_frame scan ${basename(targetPath)}`,
  }).stdout;
  return parseNativeTargetEhFrameText({
    readelfFrames,
    mapping: location.targetModule.textMapping,
    functionName: basename(location.targetModule.path),
    targetAddress: location.targetAddress,
    loadBias: location.targetModule.loadBias,
  });
}

function sourceFrameForTargetLocation(
  frames: NativeDiscoveredUnwindFrame[],
  threadId: string,
  sourceAddress: string,
) {
  return (
    frames.find(
      (frame) => frame.id.startsWith(`frame:${threadId}:`) && frame.sourcePc === sourceAddress,
    ) ?? frames.find((frame) => frame.sourcePc === sourceAddress)
  );
}

function targetUnwindRefused(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeTargetUnwindMatchResult {
  return { matches: [], refusals: [{ code, message }] };
}

function resolveActualTargetPath(targetRoot: string | undefined, modulePath: string): string {
  if (!targetRoot) {
    return modulePath;
  }
  return join(targetRoot, isAbsolute(modulePath) ? modulePath.slice(1) : modulePath);
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
    sourceUnwindRules: planned.sourceUnwindRules.length,
    sourceUnwindRefusals: planned.sourceUnwindRefusals,
    targetUnwindMatches: planned.targetUnwind?.matches.length ?? 0,
    targetUnwindRefusals: planned.targetUnwind?.refusals ?? [],
    targetFrameStateRequirements: planned.targetFrameState.requirements,
    targetFrameStateMaterialized: planned.targetFrameState.materialized,
    targetFrameStateRefusals: planned.targetFrameState.refusals,
    targetCallerFrame: planned.targetCallerFrame.frame,
    targetCallerFrameRefusals: planned.targetCallerFrame.refusals,
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
