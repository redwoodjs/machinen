#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  classifyNativeActiveSyscalls,
  type NativeActivePpollTimeoutContinuation,
  type NativeActiveSleepTimerContinuation,
} from "../packages/runtime/src/native-active-syscall-policy.ts";
import { planNativeMappingMaterialization } from "../packages/runtime/src/native-mapping-materialization.ts";
import { inventoryNativeActualTargetModules } from "../packages/runtime/src/native-actual-target-module-inventory.ts";
import {
  inventoryNativeSourceCodeModules,
  nativeSleepTimerSymbolPriority,
  nativeSymbolBaseName,
  resolveNativeRealUtilityCodeLocations,
  type NativeRealUtilityTargetModule,
  type NativeRealUtilityTargetSemanticContinuation,
} from "../packages/runtime/src/native-real-utility-code-map.ts";
import { planNativeActualRealUtilityContinuationAttempt } from "../packages/runtime/src/native-actual-real-utility-continuation.ts";
import { materializeNativeTargetModuleBytes } from "../packages/runtime/src/native-target-module-bytes.ts";
import { buildNativeSyntheticPpollSyscallContinuation } from "../packages/runtime/src/native-synthetic-ppoll-continuation.ts";
import {
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_FAILURE_EXIT_STATUS,
  buildNativeSyntheticSleepSyscallContinuation,
} from "../packages/runtime/src/native-synthetic-sleep-continuation.ts";
import { planNativeTargetFrameStateMaterialization } from "../packages/runtime/src/native-target-frame-state.ts";
import { planNativeSyntheticTargetCallerFrame } from "../packages/runtime/src/native-target-caller-frame.ts";
import {
  inspectNativeTargetResumeLanding,
  nativeTargetResumeLandingRefusals,
  type NativeTargetResumeLandingProvenance,
} from "../packages/runtime/src/native-target-landing-provenance.ts";
import {
  classifyNativeTargetResumeExecutionAttempt,
  planNativeTargetResumeExecution,
  type NativeTargetResumeExecutionAttempt,
} from "../packages/runtime/src/native-target-resume-execution.ts";
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
  NATIVE_ACTUAL_RESUME_TRAMPOLINE_SOURCE,
  NATIVE_CAPTURE_SOURCE,
  NATIVE_PPOLL_EVENTFD_TIMEOUT_TARGET_SOURCE,
  NATIVE_PPOLL_PIPE_TIMEOUT_TARGET_SOURCE,
  NATIVE_PPOLL_TIMERFD_TIMEOUT_TARGET_SOURCE,
  NATIVE_PPOLL_TIMEOUT_TARGET_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  bundleFileStats,
  compileNativeActualResumeTrampoline,
  compileNativePpollEventfdTimeoutTarget,
  compileNativePpollPipeTimeoutTarget,
  compileNativePpollTimerfdTimeoutTarget,
  compileNativePpollTimeoutTarget,
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
const PPOLL_SYSCALL_POLICY_ENV = "MACHINEN_ACTUAL_REAL_UTILITY_PPOLL_SYSCALL_POLICY";
const PPOLL_FD_POLICY_ENV = "MACHINEN_ACTUAL_REAL_UTILITY_PPOLL_FD_POLICY";
const SYNTHETIC_COMPLETION_ENV = "MACHINEN_ACTUAL_REAL_UTILITY_SYNTHETIC_COMPLETION";
const WORKLOAD_ENV = "MACHINEN_ACTUAL_REAL_UTILITY_WORKLOAD";
const UTILITY_NAME = "sleep";
const PERL_PPOLL_PIPE_SNIPPET =
  "use IO::Poll qw(POLLIN); pipe(my $r, my $w) or die qq(pipe: $!); my $p = IO::Poll->new(); $p->mask($r => POLLIN); $p->poll(2);";
const SETTLE_MS = "150";
const TARGET_BYTE_WINDOW = 32;
const SOURCE_UNWIND_FILE = "native-source-unwind.json";
const ACTUAL_RESUME_STACK_SIZE = 64 * 1024;
const ACTUAL_RESUME_TARGET_STACK_START = 0x500000000000n;
const ACTUAL_RESUME_TARGET_STACK_POINTER =
  ACTUAL_RESUME_TARGET_STACK_START + BigInt(ACTUAL_RESUME_STACK_SIZE);

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
  const workload = actualUtilityWorkload();
  ensureSourcesExist(workload.requiredSources);
  const binDir = join(outDir, "bin");
  const bundleDir = join(outDir, "actual-real-utility-source-bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });
  const capturer = compileNativeProcessCapturer(binDir);
  const command = workload.command(binDir);
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
      utility: { name: workload.name, command },
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

interface ActualUtilityWorkloadSpec {
  name: string;
  requiredSources: string[];
  command: (binDir: string) => string[];
}

function actualUtilityWorkload(): ActualUtilityWorkloadSpec {
  const workloads: Record<string, ActualUtilityWorkloadSpec> = {
    ppoll: {
      name: "ppoll-timeout",
      requiredSources: [NATIVE_CAPTURE_SOURCE, NATIVE_PPOLL_TIMEOUT_TARGET_SOURCE],
      command: (binDir) => [compileNativePpollTimeoutTarget(binDir)],
    },
    "ppoll-pipe": {
      name: "ppoll-pipe-timeout",
      requiredSources: [NATIVE_CAPTURE_SOURCE, NATIVE_PPOLL_PIPE_TIMEOUT_TARGET_SOURCE],
      command: (binDir) => [compileNativePpollPipeTimeoutTarget(binDir)],
    },
    "ppoll-eventfd": {
      name: "ppoll-eventfd-timeout",
      requiredSources: [NATIVE_CAPTURE_SOURCE, NATIVE_PPOLL_EVENTFD_TIMEOUT_TARGET_SOURCE],
      command: (binDir) => [compileNativePpollEventfdTimeoutTarget(binDir)],
    },
    "ppoll-timerfd": {
      name: "ppoll-timerfd-timeout",
      requiredSources: [NATIVE_CAPTURE_SOURCE, NATIVE_PPOLL_TIMERFD_TIMEOUT_TARGET_SOURCE],
      command: (binDir) => [compileNativePpollTimerfdTimeoutTarget(binDir)],
    },
    "perl-ppoll-pipe": {
      name: "perl-ppoll-pipe-timeout",
      requiredSources: [NATIVE_CAPTURE_SOURCE],
      command: () => [
        requireUtility(["/usr/bin/perl", "/bin/perl"]),
        "-MIO::Poll=POLLIN",
        "-e",
        PERL_PPOLL_PIPE_SNIPPET,
      ],
    },
  };
  return (
    workloads[process.env[WORKLOAD_ENV] ?? ""] ?? {
      name: UTILITY_NAME,
      requiredSources: [NATIVE_CAPTURE_SOURCE],
      command: () => [requireUtility(["/bin/sleep", "/usr/bin/sleep"]), "30"],
    }
  );
}

function consumeAmd64ActualUtility(outDir: string, sourceBundleDir: string) {
  const targetRoot = process.env[TARGET_ROOT_ENV] ?? "/";
  const planned = planCapturedActualUtilityBundle(sourceBundleDir, {
    targetRoot,
    explicitTargetModulePath: process.env[TARGET_MODULE_PATH_ENV],
  });
  assert(planned.bundle.manifest.capture.sourceArch === "arm64", "source bundle must be arm64");
  assert(planned.bundle.manifest.target.arch === "amd64", "source bundle target must be amd64");
  const resumeAttempt = executeActualTargetResumeAttempt(outDir, planned);
  return actualUtilitySummary({
    phase: "actual-real-utility-target-plan",
    hostArch: "amd64",
    sourceBundleDir,
    targetRoot,
    command: planned.bundle.manifest.process.argv,
    planned,
    resumeAttempt,
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
    sourceUnwindRequired: sourceUnwindRequired(inputs),
    targetUnwind: inputs.targetUnwind,
    targetUnwindMatched: targetUnwindMatched(inputs),
    targetFrameState: inputs.targetFrameState,
    targetModuleByteRefusals: inputs.targetBytes.refusals,
    targetCallerFrameRefusals: inputs.targetCallerFrame.refusals,
    targetCallerFrameMaterialized: inputs.targetCallerFrame.state === "planned",
    targetResumeExecutionRefusals: inputs.targetResumeExecution.refusals,
    targetResumeExecutionPlanned: inputs.targetResumeExecution.state === "planned",
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

function targetUnwindMatched(inputs: ReturnType<typeof actualUtilityPlanningInputs>): boolean {
  return inputs.targetUnwind.matches.length > 0 || hasControlledSyntheticContinuation(inputs);
}

function sourceUnwindRequired(inputs: ReturnType<typeof actualUtilityPlanningInputs>): boolean {
  return !hasControlledSyntheticContinuation(inputs);
}

function hasControlledSyntheticContinuation(
  inputs: ReturnType<typeof actualUtilityPlanningInputs>,
): boolean {
  return inputs.code.resolved.some(isControlledSyntheticLocation);
}

function isControlledSyntheticLocation(
  location: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"][number],
): boolean {
  return (
    isSyntheticSyscallStrategy(location.continuationStrategy) &&
    isControlledSyntheticCompletion(location.syntheticContinuation?.completionMode)
  );
}

function isControlledSyntheticCompletion(completionMode: string | undefined): boolean {
  return completionMode === "exit-process" || completionMode === "return-to-trampoline";
}

function hasActiveContinuation(
  activeSyscalls: ReturnType<typeof classifyNativeActiveSyscalls>,
  syscallClass: "sleep-timer" | "poll-timeout",
): boolean {
  return activeSyscalls.continuations.some(
    (continuation) => continuation.syscallClass === syscallClass,
  );
}

function syntheticEmptyPipeFds(
  activeSyscalls: ReturnType<typeof classifyNativeActiveSyscalls>,
): number[] {
  return syntheticPpollFds(activeSyscalls, "synthetic-empty-pipe-read-end");
}

function syntheticEmptyEventFds(
  activeSyscalls: ReturnType<typeof classifyNativeActiveSyscalls>,
): number[] {
  return syntheticPpollFds(activeSyscalls, "synthetic-empty-eventfd");
}

function syntheticTimerFds(
  activeSyscalls: ReturnType<typeof classifyNativeActiveSyscalls>,
): number[] {
  return syntheticPpollFds(activeSyscalls, "synthetic-timerfd");
}

function syntheticPpollFds(
  activeSyscalls: ReturnType<typeof classifyNativeActiveSyscalls>,
  targetResource: string,
): number[] {
  return activeSyscalls.continuations.flatMap((continuation) =>
    continuation.syscallClass === "poll-timeout"
      ? (continuation.metadata.ppollTimeout.pollFds ?? [])
          .filter((pollFd) => pollFd.targetResource === targetResource)
          .map((pollFd) => pollFd.fd)
      : [],
  );
}

function isSyntheticSyscallStrategy(strategy: string): boolean {
  return strategy === "synthetic-sleep-syscall" || strategy === "synthetic-ppoll-syscall";
}

function actualUtilityPlanningInputs(
  bundleDir: string,
  options: { targetRoot?: string; explicitTargetModulePath?: string },
) {
  const bundle = validateNativeProcessImageBundle(bundleDir);
  const memoryBytes = statSync(join(bundleDir, "native-memory.bin")).size;
  const activeSyscalls = classifyNativeActiveSyscalls(bundle.threads.threads, {
    sleepTimerPolicy: sleepTimerPolicy(),
    pollTimeoutPolicy: ppollTimeoutPolicy(),
    pollTimeoutFdPolicy: ppollTimeoutFdPolicy(),
    documents: bundle,
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
    syntheticEmptyPipeFds: syntheticEmptyPipeFds(activeSyscalls),
    syntheticEmptyEventFds: syntheticEmptyEventFds(activeSyscalls),
    syntheticTimerFds: syntheticTimerFds(activeSyscalls),
  });
  const mappings = planNativeMappingMaterialization({
    mappings: bundle.mappings.mappings,
    memorySizeBytes: memoryBytes,
  });
  const sourceModules = inventoryNativeSourceCodeModules(bundle);
  const targetInventory = inventoryNativeActualTargetModules({
    sourceModules,
    targetArch: "amd64",
    targetRoot: options.targetRoot,
    explicitTargetModulePath: options.explicitTargetModulePath,
  });
  const targetModules = attachActualSemanticTargetContinuations({
    targetModules: targetInventory.targetModules,
    targetRoot: options.targetRoot,
    continuations: activeSyscalls.continuations,
  });
  const code = resolveNativeRealUtilityCodeLocations({
    documents: bundle,
    targetArch: "amd64",
    targetModules,
    activeSyscallContinuations: activeSyscalls.continuations,
    sleepTimerContinuationStrategy: hasActiveContinuation(activeSyscalls, "sleep-timer")
      ? "synthetic-syscall"
      : "target-symbol",
    pollTimeoutContinuationStrategy: hasActiveContinuation(activeSyscalls, "poll-timeout")
      ? "synthetic-syscall"
      : "refuse",
    syntheticSleepCompletionMode: syntheticCompletionMode(),
    syntheticPpollCompletionMode: syntheticCompletionMode(),
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
    policy: {
      mode: "abi-neutral-sentinel",
      stackPointer: finalJumpHex(ACTUAL_RESUME_TARGET_STACK_POINTER),
    },
  });
  const targetBytes = materializeResolvedTargetBytes(code.resolved, options.targetRoot);
  const targetLandingProvenance = inspectActualTargetResumeLandings({
    resolved: code.resolved,
    targetBytes: targetBytes.materialized,
    targetUnwind,
    targetRoot: options.targetRoot,
  });
  const targetResumeExecution = planNativeTargetResumeExecution({
    codeLocations: code.codeLocations,
    callerFrame: targetCallerFrame.frame,
    targetModuleBytes: targetBytes.materialized,
  });
  return {
    bundle,
    memoryBytes,
    activeSyscalls,
    registers,
    resources,
    mappings,
    sourceModules,
    targetModules: code.targetModules,
    code,
    sourceUnwind,
    targetUnwind,
    targetFrameState,
    targetCallerFrame,
    targetBytes,
    targetLandingProvenance,
    targetResumeExecution,
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

function attachActualSemanticTargetContinuations(options: {
  targetModules: NativeRealUtilityTargetModule[];
  targetRoot?: string;
  continuations: ReturnType<typeof classifyNativeActiveSyscalls>["continuations"];
}): NativeRealUtilityTargetModule[] {
  if (!options.continuations.some((continuation) => continuation.syscallClass === "sleep-timer")) {
    return options.targetModules;
  }
  return options.targetModules.map((module) => ({
    ...module,
    semanticContinuations: uniqueSemanticContinuations([
      ...(module.semanticContinuations ?? []),
      ...discoverActualSleepTimerContinuations(module, options),
    ]),
  }));
}

function discoverActualSleepTimerContinuations(
  module: NativeRealUtilityTargetModule,
  options: {
    targetRoot?: string;
    continuations: ReturnType<typeof classifyNativeActiveSyscalls>["continuations"];
  },
): NativeRealUtilityTargetSemanticContinuation[] {
  const targetPath = resolveActualTargetPath(options.targetRoot, module.path);
  if (!existsSync(targetPath)) {
    return [];
  }
  const symbols = parseTargetDynamicSymbols(
    runCommand("readelf", ["--dyn-syms", "--wide", targetPath], {
      label: `actual target dynamic symbols ${basename(targetPath)}`,
    }).stdout,
  );
  return options.continuations.flatMap((continuation) =>
    semanticContinuationForSleepSymbol(symbols, continuation.syscall.name),
  );
}

function semanticContinuationForSleepSymbol(
  symbols: TargetDynamicSymbol[],
  syscallName: string | undefined,
): NativeRealUtilityTargetSemanticContinuation[] {
  const symbol = bestSleepTimerSymbol(symbols, syscallName);
  if (!symbol) {
    return [];
  }
  return [
    {
      kind: "sleep-timer",
      source: "elf-symbol",
      symbolName: symbol.name,
      relativeAddress: symbol.relativeAddress,
      sizeBytes: symbol.sizeBytes,
    },
  ];
}

interface TargetDynamicSymbol {
  name: string;
  baseName: string;
  relativeAddress: string;
  sizeBytes: number;
  defaultVersion: boolean;
}

function parseTargetDynamicSymbols(stdout: string): TargetDynamicSymbol[] {
  const symbols: TargetDynamicSymbol[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const symbol = parseTargetDynamicSymbol(line);
    if (symbol) {
      symbols.push(symbol);
    }
  }
  return symbols;
}

// fallow-ignore-next-line complexity
function parseTargetDynamicSymbol(line: string): TargetDynamicSymbol | undefined {
  const match = /^\s*\d+:\s+([0-9a-fA-F]+)\s+(\d+)\s+FUNC\s+\S+\s+DEFAULT\s+\S+\s+(.+?)\s*$/.exec(
    line,
  );
  if (!match?.[1] || !match[2] || !match[3] || match[1] === "0000000000000000") {
    return undefined;
  }
  return {
    name: match[3],
    baseName: nativeSymbolBaseName(match[3]),
    relativeAddress: `0x${BigInt(`0x${match[1]}`).toString(16)}`,
    sizeBytes: Number.parseInt(match[2], 10),
    defaultVersion: match[3].includes("@@"),
  };
}

function bestSleepTimerSymbol(
  symbols: TargetDynamicSymbol[],
  syscallName: string | undefined,
): TargetDynamicSymbol | undefined {
  const priority = nativeSleepTimerSymbolPriority(syscallName);
  return symbols
    .filter((symbol) => priority.includes(symbol.baseName))
    .sort((left, right) => compareSleepTimerSymbols(left, right, priority))[0];
}

function compareSleepTimerSymbols(
  left: TargetDynamicSymbol,
  right: TargetDynamicSymbol,
  priority: string[],
): number {
  const priorityDelta = priority.indexOf(left.baseName) - priority.indexOf(right.baseName);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  if (left.defaultVersion !== right.defaultVersion) {
    return left.defaultVersion ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function uniqueSemanticContinuations(
  continuations: NativeRealUtilityTargetSemanticContinuation[],
): NativeRealUtilityTargetSemanticContinuation[] {
  const seen = new Set<string>();
  return continuations.filter((continuation) => {
    const key = `${continuation.kind}:${continuation.symbolName}:${continuation.relativeAddress}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function materializeResolvedTargetBytes(
  resolved: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"],
  targetRoot: string | undefined,
) {
  const materialized = [];
  const refusals = [];
  for (const location of resolved) {
    const bytes = isSyntheticSyscallStrategy(location.continuationStrategy)
      ? materializeSyntheticSyscallTargetBytes(location)
      : materializeNativeTargetModuleBytes({
          module: location.targetModule,
          targetRoot,
          relativeStart: location.targetRva,
          sizeBytes: TARGET_BYTE_WINDOW,
        });
    if (bytes.materialized) {
      materialized.push(bytes.materialized);
    }
    refusals.push(...bytes.refusals);
  }
  return { materialized, refusals };
}

function materializeSyntheticSyscallTargetBytes(
  location: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"][number],
): ReturnType<typeof materializeNativeTargetModuleBytes> {
  const landing = location.deferredActiveSyscallLanding;
  assert(landing, "synthetic syscall target bytes require a deferred syscall landing");
  if (landing.syscallClass === "poll-timeout") {
    return materializeSyntheticPpollTargetBytes(
      location,
      landing.metadata as NativeActivePpollTimeoutContinuation["metadata"],
    );
  }
  return materializeSyntheticSleepTargetBytes(
    location,
    landing.metadata as NativeActiveSleepTimerContinuation["metadata"],
  );
}

function materializeSyntheticSleepTargetBytes(
  location: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"][number],
  metadata: NativeActiveSleepTimerContinuation["metadata"],
): ReturnType<typeof materializeNativeTargetModuleBytes> {
  const synthetic = buildNativeSyntheticSleepSyscallContinuation({
    threadId: location.threadId,
    remainingTime: metadata.remainingTime,
    sleepTimer: metadata.sleepTimer,
    targetAddress: location.targetAddress,
    completionMode: location.syntheticContinuation?.completionMode,
  });
  return materializedSyntheticTargetBytes(location, synthetic);
}

function materializeSyntheticPpollTargetBytes(
  location: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"][number],
  metadata: NativeActivePpollTimeoutContinuation["metadata"],
): ReturnType<typeof materializeNativeTargetModuleBytes> {
  const synthetic = buildNativeSyntheticPpollSyscallContinuation({
    threadId: location.threadId,
    remainingTime: metadata.remainingTime,
    ppollTimeout: metadata.ppollTimeout,
    targetAddress: location.targetAddress,
    completionMode: location.syntheticContinuation?.completionMode,
  });
  return materializedSyntheticTargetBytes(location, synthetic);
}

function materializedSyntheticTargetBytes(
  location: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"][number],
  synthetic: ReturnType<
    | typeof buildNativeSyntheticSleepSyscallContinuation
    | typeof buildNativeSyntheticPpollSyscallContinuation
  >,
): ReturnType<typeof materializeNativeTargetModuleBytes> {
  if (!synthetic.continuation) {
    return { refusals: synthetic.refusals };
  }
  return {
    materialized: {
      moduleId: location.targetModule.id,
      path: location.targetModule.path,
      buildId: location.targetModule.buildId,
      relativeStart: "0x0",
      relativeEnd: finalJumpHex(BigInt(synthetic.continuation.sizeBytes)),
      fileOffset: 0,
      sizeBytes: synthetic.continuation.sizeBytes,
      bytes: synthetic.continuation.bytes,
      sourceTextReusedAsTargetCode: false,
    },
    refusals: [],
  };
}

function inspectActualTargetResumeLandings(options: {
  resolved: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"];
  targetBytes: ReturnType<typeof materializeResolvedTargetBytes>["materialized"];
  targetUnwind: NativeTargetUnwindMatchResult;
  targetRoot?: string;
}): NativeTargetResumeLandingProvenance[] {
  // fallow-ignore-next-line complexity
  return options.resolved.map((location) => {
    const targetBytes = options.targetBytes.find(
      (bytes) =>
        bytes.moduleId === location.targetModule.id && bytes.relativeStart === location.targetRva,
    );
    if (isSyntheticSyscallStrategy(location.continuationStrategy)) {
      return inspectNativeTargetResumeLanding({ location, targetBytes });
    }
    const targetPath = resolveActualTargetPath(options.targetRoot, location.targetModule.path);
    const fde = options.targetUnwind.matches.find(
      (match) => match.targetAddress === location.targetAddress,
    )?.targetRule;
    const disassemblyRange = actualTargetDisassemblyRange(location, fde);
    return inspectNativeTargetResumeLanding({
      location,
      targetBytes,
      targetUnwindMatches: options.targetUnwind.matches,
      readelfSections: targetMetadata(targetPath, ["--sections", "--wide"], "sections"),
      readelfSymbols: targetMetadata(targetPath, ["--symbols", "--wide"], "symbols"),
      objdumpDisassembly: targetObjdumpDisassembly(targetPath, disassemblyRange),
      disassemblyAddressStart: disassemblyRange?.start,
      disassemblyAddressEnd: disassemblyRange?.end,
    });
  });
}

function actualTargetDisassemblyRange(
  location: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"][number],
  fde: NativeTargetUnwindMatchResult["matches"][number]["targetRule"] | undefined,
): { start: string; end: string } | undefined {
  const targetRelative = BigInt(location.targetAddress) - BigInt(location.targetModule.loadBias);
  const loadBias = BigInt(location.targetModule.loadBias);
  return {
    start: finalJumpHex(actualTargetDisassemblyStart(targetRelative, fde, loadBias)),
    end: finalJumpHex(actualTargetDisassemblyEnd(targetRelative, fde, loadBias)),
  };
}

function actualTargetDisassemblyStart(
  targetRelative: bigint,
  fde: NativeTargetUnwindMatchResult["matches"][number]["targetRule"] | undefined,
  loadBias: bigint,
): bigint {
  const fdeStart = fde ? BigInt(fde.pcStart) - loadBias : undefined;
  return fdeStart !== undefined && fdeStart <= targetRelative
    ? fdeStart
    : clampFloor(targetRelative - 64n);
}

// fallow-ignore-next-line complexity
function actualTargetDisassemblyEnd(
  targetRelative: bigint,
  fde: NativeTargetUnwindMatchResult["matches"][number]["targetRule"] | undefined,
  loadBias: bigint,
): bigint {
  const fdeEnd = fde ? BigInt(fde.pcEnd) - loadBias : undefined;
  const maxEnd = targetRelative + 96n;
  return fdeEnd !== undefined && fdeEnd > targetRelative && fdeEnd < maxEnd ? fdeEnd : maxEnd;
}

function targetMetadata(
  targetPath: string,
  readelfArgs: string[],
  label: string,
): string | undefined {
  if (!existsSync(targetPath)) {
    return undefined;
  }
  return runCommand("readelf", [...readelfArgs, targetPath], {
    label: `actual target ${label} ${basename(targetPath)}`,
  }).stdout;
}

function targetObjdumpDisassembly(
  targetPath: string,
  range: { start: string; end: string } | undefined,
): string | undefined {
  if (!existsSync(targetPath) || !range) {
    return undefined;
  }
  return runCommand(
    "objdump",
    ["-d", "--start-address", range.start, "--stop-address", range.end, targetPath],
    { label: `actual target disassembly ${basename(targetPath)}` },
  ).stdout;
}

function clampFloor(value: bigint): bigint {
  return value < 0n ? 0n : value;
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

// fallow-ignore-next-line complexity
function discoverActualTargetUnwindForLocation(
  location: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"][number],
  sourceFrames: NativeDiscoveredUnwindFrame[],
  targetRoot: string | undefined,
): NativeTargetUnwindMatchResult {
  if (isSyntheticSyscallStrategy(location.continuationStrategy)) {
    return { matches: [], refusals: [] };
  }
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

// fallow-ignore-next-line complexity
function executeActualTargetResumeAttempt(
  outDir: string,
  planned: ReturnType<typeof planCapturedActualUtilityBundle>,
): NativeTargetResumeExecutionAttempt | undefined {
  if (planned.plan.state !== "ready" || !planned.targetResumeExecution.plan) {
    return undefined;
  }
  const targetBytes = planned.targetBytes.materialized[0];
  assert(targetBytes, "ready actual resume plan has no target bytes");
  ensureSourcesExist([NATIVE_ACTUAL_RESUME_TRAMPOLINE_SOURCE]);
  const binDir = join(outDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const trampoline = compileNativeActualResumeTrampoline(binDir);
  const codeFile = actualResumeCodeFile(outDir, targetBytes);
  const result = spawnSync(
    trampoline,
    [
      "--code-file",
      codeFile.path,
      "--file-offset",
      String(codeFile.fileOffset),
      "--code-size",
      String(targetBytes.sizeBytes),
      "--target-address",
      planned.targetResumeExecution.plan.entryAddress,
      "--timeout-seconds",
      String(actualResumeTimeoutSeconds(planned)),
      ...actualResumeSyntheticResourceArgs(planned),
      "--stack-target-start",
      finalJumpHex(ACTUAL_RESUME_TARGET_STACK_START),
      "--stack-size",
      String(ACTUAL_RESUME_STACK_SIZE),
      "--stack-pointer",
      planned.targetResumeExecution.plan.stackPointer,
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  const line = result.stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("MACHINEN_ACTUAL_RESUME_TRAMPOLINE "));
  const synthetic = syntheticSleepContinuationSummaries(planned)[0];
  if (!line && synthetic && syntheticExitStatus(result.status, synthetic)) {
    return normalizeActualProcessExitAttempt(planned, targetBytes, result.status!);
  }
  assert(
    result.status === 0,
    `native actual target resume trampoline failed: ${result.stderr || result.stdout}`,
  );
  assert(line, "native actual target resume trampoline did not emit an event");
  return normalizeActualResumeAttempt(
    JSON.parse(line.slice("MACHINEN_ACTUAL_RESUME_TRAMPOLINE ".length)),
  );
}

function syntheticExitStatus(
  status: number | null,
  synthetic: ReturnType<typeof syntheticSleepContinuationSummaries>[number],
): boolean {
  if (status === null) {
    return false;
  }
  return syntheticExitStatuses(synthetic).has(status);
}

function syntheticExitStatuses(
  synthetic: ReturnType<typeof syntheticSleepContinuationSummaries>[number],
): Set<number> {
  const statuses = new Set([0, NATIVE_SYNTHETIC_SLEEP_SYSCALL_FAILURE_EXIT_STATUS]);
  const legacyFailureStatus = synthetic.descriptor?.completion.failureExitStatus;
  if (legacyFailureStatus !== undefined) {
    statuses.add(legacyFailureStatus);
  }
  for (const bucket of synthetic.descriptor?.completion.failureExitBuckets ?? []) {
    statuses.add(bucket.exitStatus);
  }
  return statuses;
}

function actualResumeCodeFile(
  outDir: string,
  targetBytes: ReturnType<typeof materializeResolvedTargetBytes>["materialized"][number],
): { path: string; fileOffset: number } {
  if (existsSync(targetBytes.path)) {
    return { path: targetBytes.path, fileOffset: targetBytes.fileOffset };
  }
  const syntheticPath = join(
    outDir,
    `${targetBytes.moduleId.replace(/[^a-zA-Z0-9_.-]/g, "-")}.bin`,
  );
  writeFileSync(syntheticPath, targetBytes.bytes);
  return { path: syntheticPath, fileOffset: 0 };
}

function actualResumeSyntheticResourceArgs(
  planned: ReturnType<typeof planCapturedActualUtilityBundle>,
): string[] {
  return eventfdResumeArgs(planned) ?? timerfdResumeArgs(planned) ?? pipeResumeArgs(planned) ?? [];
}

function eventfdResumeArgs(planned: ReturnType<typeof planCapturedActualUtilityBundle>) {
  const fd = syntheticPpollFdForPlan(planned, "synthetic-empty-eventfd");
  return fd === undefined ? undefined : ["--synthetic-empty-eventfd", String(fd)];
}

function timerfdResumeArgs(planned: ReturnType<typeof planCapturedActualUtilityBundle>) {
  const fd = syntheticPpollFdForPlan(planned, "synthetic-timerfd");
  return fd === undefined ? undefined : ["--synthetic-timerfd", String(fd)];
}

function pipeResumeArgs(planned: ReturnType<typeof planCapturedActualUtilityBundle>) {
  const readFd = syntheticPpollFdForPlan(planned, "synthetic-empty-pipe-read-end");
  if (readFd === undefined) {
    return undefined;
  }
  const writeFd = syntheticEmptyPipeWriteFdForPlan(planned, readFd);
  return [
    "--synthetic-empty-pipe-read-fd",
    String(readFd),
    ...(writeFd === undefined ? [] : ["--synthetic-empty-pipe-write-fd", String(writeFd)]),
  ];
}

function syntheticPpollFdForPlan(
  planned: ReturnType<typeof planCapturedActualUtilityBundle>,
  targetResource: string,
): number | undefined {
  return syntheticPpollFds(planned.activeSyscalls, targetResource)[0];
}

function syntheticEmptyPipeWriteFdForPlan(
  planned: ReturnType<typeof planCapturedActualUtilityBundle>,
  readFd: number,
): number | undefined {
  const resource = planned.resources.resources.find(
    (candidate) =>
      candidate.recipe?.synthetic === "empty-pipe-write-end" &&
      candidate.recipe.pairedReadFd === readFd,
  );
  return typeof resource?.fd === "number" ? resource.fd : undefined;
}

function actualResumeTimeoutSeconds(planned: ReturnType<typeof planCapturedActualUtilityBundle>) {
  const synthetic = syntheticSleepContinuationSummaries(planned)[0];
  if (!synthetic) {
    return 1;
  }
  const seconds = Number.parseInt(synthetic.remainingTime.seconds, 10);
  return Number.isFinite(seconds) ? Math.max(2, seconds + 5) : 35;
}

function normalizeActualProcessExitAttempt(
  planned: ReturnType<typeof planCapturedActualUtilityBundle>,
  targetBytes: ReturnType<typeof materializeResolvedTargetBytes>["materialized"][number],
  exitStatus: number,
): NativeTargetResumeExecutionAttempt {
  return {
    status: "exited",
    targetArch: "amd64",
    entryAddress: planned.targetResumeExecution.plan!.entryAddress,
    stackPointer: planned.targetResumeExecution.plan!.stackPointer,
    targetBytesStart: planned.targetResumeExecution.plan!.entryAddress,
    targetBytesEnd: finalJumpHex(
      BigInt(planned.targetResumeExecution.plan!.entryAddress) + BigInt(targetBytes.sizeBytes),
    ),
    exitStatus,
    instructionPointerInTargetBytes: true,
    attemptedResume: true,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
  };
}

function normalizeActualResumeAttempt(
  event: Record<string, unknown>,
): NativeTargetResumeExecutionAttempt {
  assertActualResumeEventInvariants(event);
  return {
    status: actualResumeStatus(event.status),
    targetArch: "amd64",
    entryAddress: String(event.entry),
    stackPointer: String(event.stackPointer),
    targetBytesStart: String(event.targetBytesStart),
    targetBytesEnd: String(event.targetBytesEnd),
    targetInstructionPointer: optionalString(event.targetInstructionPointer),
    targetInstructionBytes: optionalString(event.targetInstructionBytes),
    registers: normalizeActualResumeRegisters(event.registers),
    signal: optionalString(event.signal),
    signalNumber: optionalNumber(event.signalNumber),
    faultAddress: optionalString(event.faultAddress),
    returnValue: optionalString(event.returnValue),
    exitStatus: optionalNumber(event.exitStatus),
    instructionPointerInTargetBytes: true,
    attemptedResume: true,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
  };
}

function assertActualResumeEventInvariants(event: Record<string, unknown>) {
  assert(event.targetArch === "amd64", "actual target resume event used the wrong architecture");
  assert(event.attemptedResume === true, "actual target resume event did not attempt resume");
  assert(
    event.sourceTextReusedAsTargetCode === false,
    "actual target resume event reused source text as target code",
  );
  assert(
    event.sourceIsaEmulationUsed === false,
    "actual target resume event used source ISA emulation",
  );
  assert(event.sidecarRuntimeUsed === false, "actual target resume event used a sidecar runtime");
  assert(
    event.instructionPointerInTargetBytes === true,
    "actual target resume event did not enter the target byte window",
  );
}

function actualResumeStatus(value: unknown): NativeTargetResumeExecutionAttempt["status"] {
  if (value === "returned" || value === "exited") {
    return value;
  }
  return "faulted";
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : String(value);
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function normalizeActualResumeRegisters(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const registers = value as Record<string, unknown>;
  return Object.fromEntries(
    [
      "rax",
      "rbx",
      "rcx",
      "rdx",
      "rsi",
      "rdi",
      "rbp",
      "rsp",
      "r8",
      "r9",
      "r10",
      "r11",
      "r12",
      "r13",
      "r14",
      "r15",
    ].flatMap((name) => (registers[name] === undefined ? [] : [[name, String(registers[name])]])),
  );
}

function actualUtilitySummary(context: {
  phase: string;
  hostArch: "arm64" | "amd64";
  sourceBundleDir: string;
  targetRoot?: string;
  capturer?: string;
  command: string[];
  resumeAttempt?: NativeTargetResumeExecutionAttempt;
  outDir?: string;
  planned: ReturnType<typeof planCapturedActualUtilityBundle>;
}) {
  const { planned } = context;
  const resumeFields = resumeAttemptSummaryFields(
    context.resumeAttempt,
    planned.targetLandingProvenance,
  );
  const blockingFields = blockingSummaryFields(
    planned,
    resumeFields.targetResumeFaultClassification,
  );
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
    activeSyscallPolicy: {
      sleepTimerPolicy: sleepTimerPolicy(),
      ppollTimeoutPolicy: ppollTimeoutPolicy(),
      ppollTimeoutFdPolicy: ppollTimeoutFdPolicy(),
    },
    threadSyscalls: threadSyscallSummaries(planned),
    activeSyscallClassifications: planned.activeSyscalls.classifications,
    threadRefusals: effectiveThreadRefusals(planned),
    registerRefusals: planned.registers.refusals,
    resourceRefusals: planned.resources.refusals,
    mappingRefusals: planned.mappings.refusals,
    codeLocationRefusals: planned.code.refusals,
    semanticTargetContinuations: semanticTargetContinuationSummaries(planned),
    syntheticSleepContinuations: syntheticSleepContinuationSummaries(planned),
    syntheticSyscallContinuations: syntheticSleepContinuationSummaries(planned),
    deferredActiveSyscallLandings: deferredActiveSyscallLandingSummaries(planned),
    sourceUnwindFrames: planned.sourceFrames.length,
    sourceUnwindRules: planned.sourceUnwindRules.length,
    sourceUnwindRefusals: planned.sourceUnwindRefusals,
    ...targetUnwindSummaryFields(planned),
    targetFrameStateRequirements: planned.targetFrameState.requirements,
    targetFrameStateMaterialized: planned.targetFrameState.materialized,
    targetFrameStateRefusals: planned.targetFrameState.refusals,
    targetCallerFrame: planned.targetCallerFrame.frame,
    targetCallerFrameRefusals: planned.targetCallerFrame.refusals,
    targetResumeExecution: planned.targetResumeExecution.plan,
    targetResumeLandingProvenance: planned.targetLandingProvenance,
    targetResumeLandingRefusals: nativeTargetResumeLandingRefusals(planned.targetLandingProvenance),
    targetResumeExecutionAttempt: resumeFields.targetResumeExecutionAttempt,
    targetResumeFaultClassification: resumeFields.targetResumeFaultClassification,
    targetResumeFaultRefusals: resumeFields.targetResumeFaultRefusals,
    targetContinuationReturned: resumeFields.targetContinuationReturned,
    targetContinuationReturnValue: resumeFields.targetContinuationReturnValue,
    targetResumeExecutionRefusals: planned.targetResumeExecution.refusals,
    targetModuleByteRefusals: planned.targetBytes.refusals,
    materializedTargetBytes: materializedTargetByteSummaries(planned),
    sourceModules: planned.sourceModules.length,
    targetModules: targetModuleSummaries(planned),
    mappingSteps: planned.mappings.steps.length,
    resourceRecipes: resourceRecipeCount(planned),
    plan: planned.plan,
    blockingBoundary: blockingFields.blockingBoundary,
    blockingRefusal: blockingFields.blockingRefusal,
    attemptedResume: resumeFields.attemptedResume,
    migrationCompleted: resumeFields.migrationCompleted,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
    execution: executionForPlan(
      planned,
      context.resumeAttempt,
      resumeFields.targetResumeFaultClassification,
    ),
    bundleFiles: bundleFileStats(context.sourceBundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function targetUnwindSummaryFields(planned: ReturnType<typeof planCapturedActualUtilityBundle>) {
  return {
    targetUnwindMatches: planned.targetUnwind?.matches.length ?? 0,
    targetUnwindRefusals: planned.targetUnwind?.refusals ?? [],
  };
}

// fallow-ignore-next-line complexity
function resumeAttemptSummaryFields(
  resumeAttempt: NativeTargetResumeExecutionAttempt | undefined,
  landingProvenance: NativeTargetResumeLandingProvenance[],
) {
  const fault = classifyNativeTargetResumeExecutionAttempt(resumeAttempt, { landingProvenance });
  return {
    targetResumeExecutionAttempt: resumeAttempt,
    targetResumeFaultClassification: fault.classification,
    targetResumeFaultRefusals: fault.refusals,
    attemptedResume: resumeAttempt?.attemptedResume ?? false,
    migrationCompleted: resumeAttempt?.status === "exited" && resumeAttempt.exitStatus === 0,
    targetContinuationReturned:
      resumeAttempt?.status === "returned" && resumeAttempt.returnValue === "0x0",
    targetContinuationReturnValue: resumeAttempt?.returnValue,
  };
}

function blockingSummaryFields(
  planned: ReturnType<typeof planCapturedActualUtilityBundle>,
  faultClassification: ReturnType<
    typeof classifyNativeTargetResumeExecutionAttempt
  >["classification"],
) {
  if (faultClassification) {
    return {
      blockingBoundary: faultClassification.boundary,
      blockingRefusal: faultClassification.refusal,
    };
  }
  return {
    blockingBoundary: planned.plan.blockingBoundary,
    blockingRefusal: planned.plan.blockingRefusal,
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
    arguments: thread.syscall.arguments,
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
            sourceRva: landing.sourceRva,
            targetAddress: landing.targetAddress,
            targetRva: landing.targetRva,
            strategy: landing.strategy,
            semanticContinuation: landing.semanticContinuation,
            syntheticContinuation: landing.syntheticContinuation,
            remainingTime: landing.metadata.remainingTime,
          },
        ]
      : [];
  });
}

function semanticTargetContinuationSummaries(
  planned: ReturnType<typeof planCapturedActualUtilityBundle>,
) {
  return planned.code.resolved.flatMap((location) =>
    location.semanticContinuation
      ? [
          {
            threadId: location.threadId,
            strategy: location.continuationStrategy,
            targetModuleId: location.targetModule.id,
            ...location.semanticContinuation,
          },
        ]
      : [],
  );
}

function syntheticSleepContinuationSummaries(
  planned: ReturnType<typeof planCapturedActualUtilityBundle>,
) {
  return planned.code.resolved.flatMap((location) =>
    location.syntheticContinuation
      ? [
          {
            threadId: location.threadId,
            strategy: location.continuationStrategy,
            targetModuleId: location.targetModule.id,
            remainingTime: location.deferredActiveSyscallLanding?.metadata.remainingTime,
            ...location.syntheticContinuation,
          },
        ]
      : [],
  );
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
    semanticContinuations: module.semanticContinuations ?? [],
  }));
}

function resourceRecipeCount(planned: ReturnType<typeof planCapturedActualUtilityBundle>) {
  return planned.resources.resources.filter((resource) => resource.state === "recipe").length;
}

// fallow-ignore-next-line complexity
function executionForPlan(
  planned: ReturnType<typeof planCapturedActualUtilityBundle>,
  resumeAttempt: NativeTargetResumeExecutionAttempt | undefined,
  faultClassification: ReturnType<
    typeof classifyNativeTargetResumeExecutionAttempt
  >["classification"],
) {
  if (planned.plan.state !== "ready") {
    return `actual-real-utility-refused-at-${planned.plan.blockingBoundary}`;
  }
  if (faultClassification) {
    return `actual-real-utility-target-native-resume-faulted-at-${faultClassification.boundary}`;
  }
  if (resumeAttempt?.status === "exited" && resumeAttempt.exitStatus === 0) {
    return "actual-real-utility-target-process-exited";
  }
  if (resumeAttempt) {
    return "actual-real-utility-target-native-resume-returned";
  }
  return "actual-real-utility-ready-for-target-native-resume";
}

function sleepTimerPolicy() {
  return process.env[SLEEP_SYSCALL_POLICY_ENV] === "defer-target-resume"
    ? "defer-target-resume"
    : "refuse";
}

function ppollTimeoutPolicy() {
  return process.env[PPOLL_SYSCALL_POLICY_ENV] === "defer-target-resume"
    ? "defer-target-resume"
    : "refuse";
}

function ppollTimeoutFdPolicy() {
  if (process.env[PPOLL_FD_POLICY_ENV] === "synthetic-empty-eventfd") {
    return "synthetic-empty-eventfd";
  }
  if (process.env[PPOLL_FD_POLICY_ENV] === "synthetic-timerfd") {
    return "synthetic-timerfd";
  }
  return process.env[PPOLL_FD_POLICY_ENV] === "synthetic-empty-pipe"
    ? "synthetic-empty-pipe"
    : "zero-fd-only";
}

function syntheticCompletionMode() {
  return process.env[SYNTHETIC_COMPLETION_ENV] === "return-to-trampoline"
    ? "return-to-trampoline"
    : "exit-process";
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
