/** Real utility module/RVA code-location resolution. */

import { basename } from "node:path";
import type { NativeActiveSyscallContinuation } from "./native-active-syscall-policy.ts";
import type { NativeCodeModule } from "./native-code-map.ts";
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

export type NativeRealUtilityTargetContinuationKind = "sleep-timer";

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
  | "semantic-sleep-timer-symbol";

export interface NativeRealUtilitySemanticContinuationSelection {
  kind: NativeRealUtilityTargetContinuationKind;
  source: NativeRealUtilityTargetSemanticContinuation["source"];
  symbolName: string;
  targetRelativeAddress: string;
  targetAddress: string;
  sizeBytes?: number;
}

export interface NativeRealUtilityDeferredActiveSyscallLanding {
  threadId: string;
  sourceAddress: string;
  sourceRva: string;
  targetAddress: string;
  targetRva: string;
  strategy: Extract<NativeRealUtilityContinuationStrategy, "semantic-sleep-timer-symbol">;
  syscallClass: NativeActiveSyscallContinuation["syscallClass"];
  action: NativeActiveSyscallContinuation["action"];
  syscall: NativeActiveSyscallContinuation["syscall"];
  metadata: NativeActiveSyscallContinuation["metadata"];
  semanticContinuation: NativeRealUtilitySemanticContinuationSelection;
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
}

export interface NativeRealUtilityCodeLocationRequest {
  documents: NativeProcessImageDocuments;
  targetArch: NativeProcessImageArchitecture;
  targetModules: NativeRealUtilityTargetModule[];
  moduleExpectations?: NativeRealUtilityModuleExpectation[];
  threadIds?: string[];
  activeSyscallContinuations?: NativeActiveSyscallContinuation[];
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
    targetModules: request.targetModules,
    resolved,
    codeLocations,
    refusals,
  };
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

  const match = matchingTargetModule(request, sourceModule);
  if ("refusal" in match) {
    return match;
  }
  const sourceRva = sourcePc - BigInt(sourceModule.loadBias);
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
      continuation.syscallClass === "sleep-timer" &&
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
      semanticSelection,
    ),
    semanticContinuation: semanticSelection,
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

function resolvedLocation(
  input: CodeLocationResolutionInput & {
    targetRva: bigint;
    continuationStrategy: NativeRealUtilityContinuationStrategy;
    deferredActiveSyscallLanding?: NativeRealUtilityDeferredActiveSyscallLanding;
    semanticContinuation?: NativeRealUtilitySemanticContinuationSelection;
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
  };
}

function deferredLanding(
  input: SemanticDeferredCodeLocationInput,
  targetRva: bigint,
  targetAddress: bigint,
  semanticContinuation: NativeRealUtilitySemanticContinuationSelection,
): NativeRealUtilityDeferredActiveSyscallLanding {
  return {
    threadId: input.thread.id,
    sourceAddress: hex(input.sourcePc),
    sourceRva: hex(input.sourceRva),
    targetAddress: hex(targetAddress),
    targetRva: hex(targetRva),
    strategy: "semantic-sleep-timer-symbol",
    syscallClass: input.continuation.syscallClass,
    action: input.continuation.action,
    syscall: input.continuation.syscall,
    metadata: input.continuation.metadata,
    semanticContinuation,
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
