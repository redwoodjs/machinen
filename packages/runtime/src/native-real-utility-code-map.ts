/** Real utility module/RVA code-location resolution. */

import { basename } from "node:path";
import type {
  NativeActivePpollTimeoutContinuation,
  NativeActiveSleepTimerContinuation,
  NativeActiveSyscallContinuation,
} from "./native-active-syscall-policy.ts";
import type { NativeCodeModule } from "./native-code-map.ts";
import type { NativeSyntheticSyscallContinuationDescriptor } from "./native-synthetic-continuation.ts";
import {
  NATIVE_SYNTHETIC_PPOLL_SYSCALL_BASE,
  NATIVE_SYNTHETIC_PPOLL_SYSCALL_BUILD_ID,
  NATIVE_SYNTHETIC_PPOLL_SYSCALL_LOGICAL_NAME,
  NATIVE_SYNTHETIC_PPOLL_SYSCALL_PATH,
  buildNativeSyntheticPpollSyscallContinuation,
  type NativeSyntheticPpollCompletionMode,
  type NativeSyntheticPpollSyscallContinuation,
  type NativeSyntheticPpollSyscallContinuationProvenance,
} from "./native-synthetic-ppoll-continuation.ts";
import {
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_BASE,
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_BUILD_ID,
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_LOGICAL_NAME,
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_PATH,
  buildNativeSyntheticSleepSyscallContinuation,
  type NativeSyntheticSleepCompletionMode,
  type NativeSyntheticSleepSyscallContinuation,
  type NativeSyntheticSleepSyscallContinuationProvenance,
} from "./native-synthetic-sleep-continuation.ts";
import type {
  NativeCodeLocationMapping,
  NativeMemoryMapping,
  NativeProcessImageArchitecture,
  NativeProcessImageDocuments,
  NativeProcessImageRefusal,
  NativeRegisterState,
  NativeThreadState,
} from "./native-process-image.ts";

export interface NativeRealUtilityExecutableRange {
  relativeStart: string;
  relativeEnd: string;
}

export interface NativeRealUtilitySourceModule extends NativeCodeModule {
  sourceStart: string;
  sourceEnd: string;
}

export type NativeRealUtilityTargetContinuationKind = "sleep-timer" | "poll-timeout";

export interface NativeRealUtilityTargetSemanticContinuation {
  kind: NativeRealUtilityTargetContinuationKind;
  source: "elf-symbol";
  symbolName: string;
  relativeAddress: string;
  sizeBytes?: number;
}

export interface NativeRealUtilityTargetModule extends NativeCodeModule {
  executable?: boolean;
  executableRanges?: NativeRealUtilityExecutableRange[];
  semanticContinuations?: NativeRealUtilityTargetSemanticContinuation[];
}

export interface NativeRealUtilityModuleExpectation {
  sourcePath?: string;
  sourceLogicalName?: string;
  targetModuleId?: string;
  targetPath?: string;
  expectedTargetBuildId?: string;
}

export type NativeRealUtilityContinuationStrategy =
  | "module-rva-equivalence"
  | "semantic-sleep-timer-symbol"
  | "synthetic-sleep-syscall"
  | "synthetic-ppoll-syscall";

export interface NativeRealUtilitySemanticContinuationSelection {
  kind: NativeRealUtilityTargetContinuationKind;
  source: NativeRealUtilityTargetSemanticContinuation["source"];
  symbolName: string;
  targetRelativeAddress: string;
  targetAddress: string;
  sizeBytes?: number;
}

export type NativeRealUtilitySyntheticContinuationSelection =
  | {
      kind: "sleep-timer";
      source: "synthetic-syscall";
      symbolName: "machinen_synthetic_clock_nanosleep";
      targetRelativeAddress: "0x0";
      targetAddress: string;
      sizeBytes: number;
      syscall: NativeSyntheticSleepSyscallContinuation["syscall"];
      completionMode: NativeSyntheticSleepCompletionMode;
      exitStatusOnSuccess?: 0;
      descriptor: NativeSyntheticSyscallContinuationDescriptor;
      provenance: NativeSyntheticSleepSyscallContinuationProvenance;
    }
  | {
      kind: "poll-timeout";
      source: "synthetic-syscall";
      symbolName: "machinen_synthetic_ppoll";
      targetRelativeAddress: "0x0";
      targetAddress: string;
      sizeBytes: number;
      syscall: NativeSyntheticPpollSyscallContinuation["syscall"];
      completionMode: NativeSyntheticPpollCompletionMode;
      exitStatusOnSuccess?: 0;
      descriptor: NativeSyntheticSyscallContinuationDescriptor;
      provenance: NativeSyntheticPpollSyscallContinuationProvenance;
    };

export interface NativeRealUtilityDeferredActiveSyscallLanding {
  threadId: string;
  sourceAddress: string;
  sourceRva: string;
  targetAddress: string;
  targetRva: string;
  strategy: Extract<
    NativeRealUtilityContinuationStrategy,
    "semantic-sleep-timer-symbol" | "synthetic-sleep-syscall" | "synthetic-ppoll-syscall"
  >;
  syscallClass: NativeActiveSyscallContinuation["syscallClass"];
  action: NativeActiveSyscallContinuation["action"];
  syscall: NativeActiveSyscallContinuation["syscall"];
  metadata: NativeActiveSyscallContinuation["metadata"];
  semanticContinuation?: NativeRealUtilitySemanticContinuationSelection;
  syntheticContinuation?: NativeRealUtilitySyntheticContinuationSelection;
}

export interface NativeRealUtilityResolvedLocation {
  threadId: string;
  sourceModule: NativeRealUtilitySourceModule;
  targetModule: NativeRealUtilityTargetModule;
  sourceRva: string;
  targetRva: string;
  targetAddress: string;
  continuationStrategy: NativeRealUtilityContinuationStrategy;
  codeLocation: NativeCodeLocationMapping;
  deferredActiveSyscallLanding?: NativeRealUtilityDeferredActiveSyscallLanding;
  semanticContinuation?: NativeRealUtilitySemanticContinuationSelection;
  syntheticContinuation?: NativeRealUtilitySyntheticContinuationSelection;
}

export interface NativeRealUtilityCodeLocationRequest {
  documents: NativeProcessImageDocuments;
  targetArch: NativeProcessImageArchitecture;
  targetModules: NativeRealUtilityTargetModule[];
  moduleExpectations?: NativeRealUtilityModuleExpectation[];
  threadIds?: string[];
  activeSyscallContinuations?: NativeActiveSyscallContinuation[];
  sleepTimerContinuationStrategy?: "target-symbol" | "synthetic-syscall";
  pollTimeoutContinuationStrategy?: "refuse" | "synthetic-syscall";
  syntheticSleepBaseAddress?: string;
  syntheticPpollBaseAddress?: string;
  syntheticSleepCompletionMode?: NativeSyntheticSleepCompletionMode;
  syntheticPpollCompletionMode?: NativeSyntheticPpollCompletionMode;
}

export interface NativeRealUtilityCodeLocationResult {
  sourceModules: NativeRealUtilitySourceModule[];
  targetModules: NativeRealUtilityTargetModule[];
  resolved: NativeRealUtilityResolvedLocation[];
  codeLocations: NativeCodeLocationMapping[];
  refusals: NativeProcessImageRefusal[];
}

export function inventoryNativeSourceCodeModules(
  documents: NativeProcessImageDocuments,
): NativeRealUtilitySourceModule[] {
  return documents.mappings.mappings
    .filter((mapping) => mapping.permissions.execute && mapping.file)
    .map((mapping) => sourceModuleFromMapping(documents, mapping));
}

export function resolveNativeRealUtilityCodeLocations(
  request: NativeRealUtilityCodeLocationRequest,
): NativeRealUtilityCodeLocationResult {
  const sourceModules = inventoryNativeSourceCodeModules(request.documents);
  const threads = requestedThreads(request.documents.threads.threads, request.threadIds);
  const resolved: NativeRealUtilityResolvedLocation[] = [];
  const codeLocations: NativeCodeLocationMapping[] = [];
  const refusals: NativeProcessImageRefusal[] = [];

  for (const thread of threads) {
    const location = resolveThreadCodeLocation(request, sourceModules, thread);
    if ("refusal" in location) {
      refusals.push(location.refusal);
      codeLocations.push(refusedCodeLocation(thread, location.refusal));
      continue;
    }
    resolved.push(location);
    codeLocations.push(location.codeLocation);
  }

  return {
    sourceModules,
    targetModules: uniqueTargetModules([
      ...request.targetModules,
      ...resolved.map((location) => location.targetModule),
    ]),
    resolved,
    codeLocations,
    refusals,
  };
}

function uniqueTargetModules(
  modules: NativeRealUtilityTargetModule[],
): NativeRealUtilityTargetModule[] {
  return Array.from(new Map(modules.map((module) => [module.id, module])).values());
}

function requestedThreads(threads: NativeThreadState[], threadIds: string[] | undefined) {
  if (!threadIds) {
    return threads;
  }
  const requested = new Set(threadIds);
  return threads.filter((thread) => requested.has(thread.id));
}

function resolveThreadCodeLocation(
  request: NativeRealUtilityCodeLocationRequest,
  sourceModules: NativeRealUtilitySourceModule[],
  thread: NativeThreadState,
): NativeRealUtilityResolvedLocation | { refusal: NativeProcessImageRefusal } {
  const deferredContinuation = deferredContinuationForThread(
    request.activeSyscallContinuations ?? [],
    thread,
  );
  if (thread.syscall.state !== "outside-syscall" && !deferredContinuation) {
    return {
      refusal: refusal("active-syscall", `thread ${thread.id} is ${thread.syscall.state}`, {
        threadId: thread.id,
        syscall: thread.syscall,
      }),
    };
  }

  const sourcePc = registerProgramCounter(thread.sourceRegisters);
  const sourceModule = sourceModules.find((candidate) => addressInModule(sourcePc, candidate));
  if (!sourceModule) {
    return {
      refusal: refusal(
        "target-code-location-unresolved",
        `thread ${thread.id} pc ${hex(sourcePc)} is not inside an executable source module`,
        { threadId: thread.id, sourcePc: hex(sourcePc) },
      ),
    };
  }

  const sourceRva = sourcePc - BigInt(sourceModule.loadBias);
  const syntheticDeferred = deferredContinuation
    ? resolveSyntheticDeferredCodeLocationForThread({
        request,
        thread,
        sourceModule,
        sourcePc,
        sourceRva,
        continuation: deferredContinuation,
      })
    : undefined;
  if (syntheticDeferred) {
    return syntheticDeferred;
  }

  const match = matchingTargetModule(request, sourceModule);
  if ("refusal" in match) {
    return match;
  }
  if (deferredContinuation) {
    return resolveSemanticDeferredCodeLocation({
      thread,
      sourceModule,
      targetModule: match.targetModule,
      sourcePc,
      sourceRva,
      continuation: deferredContinuation,
    });
  }
  return resolveRvaEquivalentCodeLocation({
    thread,
    sourceModule,
    targetModule: match.targetModule,
    sourcePc,
    sourceRva,
  });
}

function deferredContinuationForThread(
  continuations: NativeActiveSyscallContinuation[],
  thread: NativeThreadState,
): NativeActiveSyscallContinuation | undefined {
  if (thread.syscall.state === "outside-syscall") {
    return undefined;
  }
  return continuations.find(
    (continuation) =>
      continuation.threadId === thread.id &&
      continuation.action === "defer-target-resume" &&
      (continuation.syscallClass === "sleep-timer" ||
        continuation.syscallClass === "poll-timeout") &&
      sameSyscall(continuation.syscall, thread.syscall),
  );
}

function sameSyscall(
  left: NativeActiveSyscallContinuation["syscall"],
  right: NativeThreadState["syscall"],
): boolean {
  return left.state === right.state && left.number === right.number && left.name === right.name;
}

interface CodeLocationResolutionInput {
  thread: NativeThreadState;
  sourceModule: NativeRealUtilitySourceModule;
  targetModule: NativeRealUtilityTargetModule;
  sourcePc: bigint;
  sourceRva: bigint;
}

interface SemanticDeferredCodeLocationInput extends CodeLocationResolutionInput {
  continuation: NativeActiveSyscallContinuation;
  syntheticSleepCompletionMode?: NativeSyntheticSleepCompletionMode;
  syntheticPpollCompletionMode?: NativeSyntheticPpollCompletionMode;
}

interface DeferredSyntheticCodeLocationInput {
  request: NativeRealUtilityCodeLocationRequest;
  thread: NativeThreadState;
  sourceModule: NativeRealUtilitySourceModule;
  sourcePc: bigint;
  sourceRva: bigint;
  continuation: NativeActiveSyscallContinuation;
}

function resolveSyntheticDeferredCodeLocationForThread(
  input: DeferredSyntheticCodeLocationInput,
): NativeRealUtilityResolvedLocation | { refusal: NativeProcessImageRefusal } | undefined {
  if (
    input.continuation.syscallClass === "poll-timeout" &&
    input.request.pollTimeoutContinuationStrategy !== "synthetic-syscall"
  ) {
    return {
      refusal: refusal(
        "target-ppoll-syscall-continuation-missing",
        `thread ${input.thread.id} has no synthetic ppoll syscall continuation strategy`,
      ),
    };
  }
  const targetModule = syntheticDeferredTargetModule(
    input.request,
    input.thread,
    input.continuation,
  );
  return targetModule
    ? resolveSyntheticDeferredCodeLocation({
        ...input,
        targetModule,
        syntheticSleepCompletionMode: input.request.syntheticSleepCompletionMode,
        syntheticPpollCompletionMode: input.request.syntheticPpollCompletionMode,
      })
    : undefined;
}

function resolveRvaEquivalentCodeLocation(
  input: CodeLocationResolutionInput,
): NativeRealUtilityResolvedLocation | { refusal: NativeProcessImageRefusal } {
  const rvaRefusal = validateTargetRva(input.targetModule, input.sourceRva);
  if (rvaRefusal) {
    return { refusal: rvaRefusal };
  }
  return resolvedLocation({
    ...input,
    targetRva: input.sourceRva,
    continuationStrategy: "module-rva-equivalence",
  });
}

function resolveSemanticDeferredCodeLocation(
  input: SemanticDeferredCodeLocationInput,
): NativeRealUtilityResolvedLocation | { refusal: NativeProcessImageRefusal } {
  const semanticContinuation = semanticSleepTimerContinuation(
    input.targetModule,
    input.continuation.syscall.name,
  );
  if (!semanticContinuation) {
    return {
      refusal: refusal(
        "target-semantic-continuation-missing",
        `target module ${input.targetModule.logicalName} has no semantic amd64 sleep/timer continuation`,
        {
          threadId: input.thread.id,
          syscallClass: input.continuation.syscallClass,
          syscall: input.continuation.syscall,
          targetModule: moduleDetail(input.targetModule),
        },
      ),
    };
  }
  const targetRva = BigInt(semanticContinuation.relativeAddress);
  const rvaRefusal = validateTargetRva(input.targetModule, targetRva);
  if (rvaRefusal) {
    return { refusal: rvaRefusal };
  }
  const targetAddress = BigInt(input.targetModule.loadBias) + targetRva;
  const semanticSelection = semanticContinuationSelection(semanticContinuation, targetAddress);
  return resolvedLocation({
    ...input,
    targetRva,
    continuationStrategy: "semantic-sleep-timer-symbol",
    deferredActiveSyscallLanding: deferredLanding(
      input,
      targetRva,
      targetAddress,
      "semantic-sleep-timer-symbol",
      semanticSelection,
    ),
    semanticContinuation: semanticSelection,
  });
}

function resolveSyntheticDeferredCodeLocation(
  input: SemanticDeferredCodeLocationInput,
): NativeRealUtilityResolvedLocation | { refusal: NativeProcessImageRefusal } {
  return input.continuation.syscallClass === "poll-timeout"
    ? resolveSyntheticPpollDeferredCodeLocation(
        input as SemanticDeferredCodeLocationInput & {
          continuation: NativeActivePpollTimeoutContinuation;
        },
      )
    : resolveSyntheticSleepDeferredCodeLocation(
        input as SemanticDeferredCodeLocationInput & {
          continuation: NativeActiveSleepTimerContinuation;
        },
      );
}

function resolveSyntheticSleepDeferredCodeLocation(
  input: SemanticDeferredCodeLocationInput & { continuation: NativeActiveSleepTimerContinuation },
): NativeRealUtilityResolvedLocation | { refusal: NativeProcessImageRefusal } {
  const synthetic = buildNativeSyntheticSleepSyscallContinuation({
    threadId: input.thread.id,
    remainingTime: input.continuation.metadata.remainingTime,
    sleepTimer: input.continuation.metadata.sleepTimer,
    targetAddress: input.targetModule.loadBias,
    completionMode: input.syntheticSleepCompletionMode,
  });
  if (synthetic.refusals[0]) {
    return { refusal: synthetic.refusals[0] };
  }
  const continuation = synthetic.continuation;
  if (!continuation) {
    return {
      refusal: refusal(
        "target-sleep-syscall-continuation-missing",
        `thread ${input.thread.id} has no synthetic sleep syscall continuation`,
      ),
    };
  }
  return syntheticResolvedLocation(input, continuation, "synthetic-sleep-syscall");
}

function resolveSyntheticPpollDeferredCodeLocation(
  input: SemanticDeferredCodeLocationInput & { continuation: NativeActivePpollTimeoutContinuation },
): NativeRealUtilityResolvedLocation | { refusal: NativeProcessImageRefusal } {
  const synthetic = buildNativeSyntheticPpollSyscallContinuation({
    threadId: input.thread.id,
    remainingTime: input.continuation.metadata.remainingTime,
    ppollTimeout: input.continuation.metadata.ppollTimeout,
    targetAddress: input.targetModule.loadBias,
    completionMode: input.syntheticPpollCompletionMode,
  });
  if (synthetic.refusals[0]) {
    return { refusal: synthetic.refusals[0] };
  }
  const continuation = synthetic.continuation;
  if (!continuation) {
    return {
      refusal: refusal(
        "target-ppoll-syscall-continuation-missing",
        `thread ${input.thread.id} has no synthetic ppoll syscall continuation`,
      ),
    };
  }
  return syntheticResolvedLocation(input, continuation, "synthetic-ppoll-syscall");
}

function syntheticResolvedLocation(
  input: SemanticDeferredCodeLocationInput,
  continuation: NativeSyntheticSleepSyscallContinuation | NativeSyntheticPpollSyscallContinuation,
  strategy: Extract<
    NativeRealUtilityContinuationStrategy,
    "synthetic-sleep-syscall" | "synthetic-ppoll-syscall"
  >,
): NativeRealUtilityResolvedLocation {
  const syntheticSelection = syntheticContinuationSelection(continuation);
  return resolvedLocation({
    ...input,
    targetRva: 0n,
    continuationStrategy: strategy,
    deferredActiveSyscallLanding: deferredLanding(
      input,
      0n,
      BigInt(continuation.entryAddress),
      strategy,
      undefined,
      syntheticSelection,
    ),
    syntheticContinuation: syntheticSelection,
  });
}

function semanticSleepTimerContinuation(
  targetModule: NativeRealUtilityTargetModule,
  syscallName: string | undefined,
): NativeRealUtilityTargetSemanticContinuation | undefined {
  const priority = nativeSleepTimerSymbolPriority(syscallName);
  return targetModule.semanticContinuations
    ?.filter(
      (candidate) =>
        candidate.kind === "sleep-timer" &&
        priority.includes(nativeSymbolBaseName(candidate.symbolName)),
    )
    .sort((left, right) => compareSemanticContinuation(left, right, priority))[0];
}

function compareSemanticContinuation(
  left: NativeRealUtilityTargetSemanticContinuation,
  right: NativeRealUtilityTargetSemanticContinuation,
  priority: string[],
): number {
  const priorityDelta =
    priority.indexOf(nativeSymbolBaseName(left.symbolName)) -
    priority.indexOf(nativeSymbolBaseName(right.symbolName));
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return left.symbolName.localeCompare(right.symbolName);
}

export function nativeSleepTimerSymbolPriority(syscallName: string | undefined): string[] {
  return syscallName === "nanosleep"
    ? ["nanosleep", "__nanosleep", "clock_nanosleep", "__clock_nanosleep"]
    : ["clock_nanosleep", "__clock_nanosleep", "nanosleep", "__nanosleep"];
}

export function nativeSymbolBaseName(name: string): string {
  return name.split("@")[0] ?? name;
}

function semanticContinuationSelection(
  continuation: NativeRealUtilityTargetSemanticContinuation,
  targetAddress: bigint,
): NativeRealUtilitySemanticContinuationSelection {
  return {
    kind: continuation.kind,
    source: continuation.source,
    symbolName: continuation.symbolName,
    targetRelativeAddress: continuation.relativeAddress,
    targetAddress: hex(targetAddress),
    sizeBytes: continuation.sizeBytes,
  };
}

function syntheticContinuationSelection(
  continuation: NativeSyntheticSleepSyscallContinuation | NativeSyntheticPpollSyscallContinuation,
): NativeRealUtilitySyntheticContinuationSelection {
  if (continuation.kind === "synthetic-ppoll-syscall") {
    return {
      kind: "poll-timeout",
      source: "synthetic-syscall",
      symbolName: "machinen_synthetic_ppoll",
      targetRelativeAddress: "0x0",
      targetAddress: continuation.entryAddress,
      sizeBytes: continuation.sizeBytes,
      syscall: continuation.syscall,
      completionMode: continuation.completionMode,
      exitStatusOnSuccess: continuation.exitStatusOnSuccess,
      descriptor: continuation.descriptor,
      provenance: continuation.provenance,
    };
  }
  return {
    kind: "sleep-timer",
    source: "synthetic-syscall",
    symbolName: "machinen_synthetic_clock_nanosleep",
    targetRelativeAddress: "0x0",
    targetAddress: continuation.entryAddress,
    sizeBytes: continuation.sizeBytes,
    syscall: continuation.syscall,
    completionMode: continuation.completionMode,
    exitStatusOnSuccess: continuation.exitStatusOnSuccess,
    descriptor: continuation.descriptor,
    provenance: continuation.provenance,
  };
}

function resolvedLocation(
  input: CodeLocationResolutionInput & {
    targetRva: bigint;
    continuationStrategy: NativeRealUtilityContinuationStrategy;
    deferredActiveSyscallLanding?: NativeRealUtilityDeferredActiveSyscallLanding;
    semanticContinuation?: NativeRealUtilitySemanticContinuationSelection;
    syntheticContinuation?: NativeRealUtilitySyntheticContinuationSelection;
  },
): NativeRealUtilityResolvedLocation {
  const targetAddress = BigInt(input.targetModule.loadBias) + input.targetRva;
  const codeLocation: NativeCodeLocationMapping = {
    id: `code:${input.thread.id}:pc`,
    sourceMapping: input.sourceModule.textMapping,
    sourceAddress: hex(input.sourcePc),
    targetAddress: hex(targetAddress),
    state: "mapped",
  };
  return {
    threadId: input.thread.id,
    sourceModule: input.sourceModule,
    targetModule: input.targetModule,
    sourceRva: hex(input.sourceRva),
    targetRva: hex(input.targetRva),
    targetAddress: hex(targetAddress),
    continuationStrategy: input.continuationStrategy,
    codeLocation,
    deferredActiveSyscallLanding: input.deferredActiveSyscallLanding,
    semanticContinuation: input.semanticContinuation,
    syntheticContinuation: input.syntheticContinuation,
  };
}

function deferredLanding(
  input: SemanticDeferredCodeLocationInput,
  targetRva: bigint,
  targetAddress: bigint,
  strategy: NativeRealUtilityDeferredActiveSyscallLanding["strategy"],
  semanticContinuation?: NativeRealUtilitySemanticContinuationSelection,
  syntheticContinuation?: NativeRealUtilitySyntheticContinuationSelection,
): NativeRealUtilityDeferredActiveSyscallLanding {
  return {
    threadId: input.thread.id,
    sourceAddress: hex(input.sourcePc),
    sourceRva: hex(input.sourceRva),
    targetAddress: hex(targetAddress),
    targetRva: hex(targetRva),
    strategy,
    syscallClass: input.continuation.syscallClass,
    action: input.continuation.action,
    syscall: input.continuation.syscall,
    metadata: input.continuation.metadata,
    semanticContinuation,
    syntheticContinuation,
  };
}

function syntheticDeferredTargetModule(
  request: NativeRealUtilityCodeLocationRequest,
  thread: NativeThreadState,
  continuation: NativeActiveSyscallContinuation,
): NativeRealUtilityTargetModule | undefined {
  if (
    continuation.syscallClass === "sleep-timer" &&
    request.sleepTimerContinuationStrategy === "synthetic-syscall"
  ) {
    return syntheticSleepTargetModule(request, thread);
  }
  if (
    continuation.syscallClass === "poll-timeout" &&
    request.pollTimeoutContinuationStrategy === "synthetic-syscall"
  ) {
    return syntheticPpollTargetModule(request, thread);
  }
  return undefined;
}

function syntheticSleepTargetModule(
  request: NativeRealUtilityCodeLocationRequest,
  thread: NativeThreadState,
): NativeRealUtilityTargetModule {
  return syntheticTargetModule({
    request,
    thread,
    baseAddress: request.syntheticSleepBaseAddress ?? NATIVE_SYNTHETIC_SLEEP_SYSCALL_BASE,
    idPrefix: "synthetic-sleep-syscall",
    logicalName: NATIVE_SYNTHETIC_SLEEP_SYSCALL_LOGICAL_NAME,
    pathPrefix: NATIVE_SYNTHETIC_SLEEP_SYSCALL_PATH,
    buildId: NATIVE_SYNTHETIC_SLEEP_SYSCALL_BUILD_ID,
  });
}

function syntheticPpollTargetModule(
  request: NativeRealUtilityCodeLocationRequest,
  thread: NativeThreadState,
): NativeRealUtilityTargetModule {
  return syntheticTargetModule({
    request,
    thread,
    baseAddress: request.syntheticPpollBaseAddress ?? NATIVE_SYNTHETIC_PPOLL_SYSCALL_BASE,
    idPrefix: "synthetic-ppoll-syscall",
    logicalName: NATIVE_SYNTHETIC_PPOLL_SYSCALL_LOGICAL_NAME,
    pathPrefix: NATIVE_SYNTHETIC_PPOLL_SYSCALL_PATH,
    buildId: NATIVE_SYNTHETIC_PPOLL_SYSCALL_BUILD_ID,
  });
}

function syntheticTargetModule(options: {
  request: NativeRealUtilityCodeLocationRequest;
  thread: NativeThreadState;
  baseAddress: string;
  idPrefix: string;
  logicalName: string;
  pathPrefix: string;
  buildId: string;
}): NativeRealUtilityTargetModule {
  const id = `target:${options.idPrefix}:${options.thread.id}`;
  return {
    id,
    logicalName: options.logicalName,
    path: `${options.pathPrefix}/${options.thread.id}`,
    arch: options.request.targetArch,
    kind: "executable",
    buildId: options.buildId,
    loadBias: options.baseAddress,
    textMapping: `${id}:text`,
    executable: true,
    executableRanges: [{ relativeStart: "0x0", relativeEnd: "0x1000" }],
  };
}

function matchingTargetModule(
  request: NativeRealUtilityCodeLocationRequest,
  sourceModule: NativeRealUtilitySourceModule,
): { targetModule: NativeRealUtilityTargetModule } | { refusal: NativeProcessImageRefusal } {
  const expectation = expectationForModule(request.moduleExpectations ?? [], sourceModule);
  const targetModule = findTargetModule(
    request.targetModules,
    request.targetArch,
    sourceModule,
    expectation,
  );
  if (!targetModule) {
    return {
      refusal: refusal(
        "target-module-missing",
        `no ${request.targetArch} target module matches ${sourceModule.logicalName}`,
        { sourceModule: moduleDetail(sourceModule), targetArch: request.targetArch, expectation },
      ),
    };
  }
  if (!isExecutableTargetModule(targetModule)) {
    return {
      refusal: refusal(
        "target-module-not-executable",
        `target module ${targetModule.logicalName} is not executable code`,
        { targetModule: moduleDetail(targetModule) },
      ),
    };
  }
  if (
    expectation?.expectedTargetBuildId &&
    normalizeBuildId(targetModule.buildId) !== normalizeBuildId(expectation.expectedTargetBuildId)
  ) {
    return {
      refusal: refusal(
        "target-build-id-mismatch",
        `target module ${targetModule.logicalName} build ${targetModule.buildId} does not match expected ${expectation.expectedTargetBuildId}`,
        {
          sourceModule: moduleDetail(sourceModule),
          targetModule: moduleDetail(targetModule),
          expectedTargetBuildId: expectation.expectedTargetBuildId,
        },
      ),
    };
  }
  return { targetModule };
}

function expectationForModule(
  expectations: NativeRealUtilityModuleExpectation[],
  sourceModule: NativeRealUtilitySourceModule,
) {
  return expectations.find(
    (expectation) =>
      expectation.sourcePath === sourceModule.path ||
      expectation.sourceLogicalName === sourceModule.logicalName,
  );
}

function findTargetModule(
  targetModules: NativeRealUtilityTargetModule[],
  targetArch: NativeProcessImageArchitecture,
  sourceModule: NativeRealUtilitySourceModule,
  expectation: NativeRealUtilityModuleExpectation | undefined,
) {
  const candidates = targetModules.filter((module) => module.arch === targetArch);
  if (expectation?.targetModuleId) {
    return candidates.find((module) => module.id === expectation.targetModuleId);
  }
  if (expectation?.targetPath) {
    return candidates.find((module) => module.path === expectation.targetPath);
  }
  return candidates.find(
    (module) =>
      module.logicalName === sourceModule.logicalName && compatibleModuleKind(module, sourceModule),
  );
}

function validateTargetRva(
  targetModule: NativeRealUtilityTargetModule,
  sourceRva: bigint,
): NativeProcessImageRefusal | undefined {
  if (!targetModule.executableRanges?.length) {
    return undefined;
  }
  const mapped = targetModule.executableRanges.some(
    (range) => sourceRva >= BigInt(range.relativeStart) && sourceRva < BigInt(range.relativeEnd),
  );
  if (mapped) {
    return undefined;
  }
  return refusal(
    "target-code-rva-unmapped",
    `target module ${targetModule.logicalName} does not map source RVA ${hex(sourceRva)} as executable code`,
    { targetModule: moduleDetail(targetModule), sourceRva: hex(sourceRva) },
  );
}

function sourceModuleFromMapping(
  documents: NativeProcessImageDocuments,
  mapping: NativeMemoryMapping,
): NativeRealUtilitySourceModule {
  const path = mapping.file?.path ?? mapping.id;
  return {
    id: `module:${mapping.id}`,
    logicalName: basename(path),
    path,
    arch: documents.manifest.capture.sourceArch,
    kind: sourceModuleKind(documents, mapping),
    buildId: mapping.file?.buildId ?? mapping.file?.sha256 ?? `captured:${mapping.id}`,
    loadBias: hex(BigInt(mapping.sourceStart) - BigInt(mapping.file?.offset ?? 0)),
    textMapping: mapping.id,
    sourceStart: mapping.sourceStart,
    sourceEnd: mapping.sourceEnd,
  };
}

function sourceModuleKind(
  documents: NativeProcessImageDocuments,
  mapping: NativeMemoryMapping,
): NativeCodeModule["kind"] {
  if (mapping.kind === "vdso") {
    return "vdso";
  }
  if (mapping.file?.path === documents.manifest.process.exe) {
    return "pie-executable";
  }
  if (mapping.file?.path) {
    return "shared-object";
  }
  return "unknown";
}

function registerProgramCounter(registers: NativeRegisterState): bigint {
  if (registers.arch === "arm64") {
    return BigInt(registers.pc);
  }
  return BigInt(registers.rip);
}

function addressInModule(address: bigint, module: NativeRealUtilitySourceModule): boolean {
  return address >= BigInt(module.sourceStart) && address < BigInt(module.sourceEnd);
}

function isExecutableTargetModule(module: NativeRealUtilityTargetModule): boolean {
  if (module.executable === false) {
    return false;
  }
  return (
    module.kind === "executable" ||
    module.kind === "pie-executable" ||
    module.kind === "shared-object"
  );
}

function compatibleModuleKind(
  target: NativeRealUtilityTargetModule,
  source: NativeRealUtilitySourceModule,
): boolean {
  if (source.kind === "pie-executable") {
    return target.kind === "pie-executable" || target.kind === "executable";
  }
  return target.kind === source.kind;
}

function refusedCodeLocation(
  thread: NativeThreadState,
  codeRefusal: NativeProcessImageRefusal,
): NativeCodeLocationMapping {
  return {
    id: `code:${thread.id}:pc`,
    sourceMapping: thread.stackMapping,
    sourceAddress: hex(registerProgramCounter(thread.sourceRegisters)),
    state: "refused",
    refusal: codeRefusal,
  };
}

function moduleDetail(module: NativeCodeModule) {
  return {
    id: module.id,
    logicalName: module.logicalName,
    path: module.path,
    arch: module.arch,
    kind: module.kind,
    buildId: module.buildId,
    loadBias: module.loadBias,
  };
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
  detail?: Record<string, unknown>,
): NativeProcessImageRefusal {
  return detail ? { code, message, detail } : { code, message };
}

function normalizeBuildId(value: string): string {
  return value.toLowerCase();
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
