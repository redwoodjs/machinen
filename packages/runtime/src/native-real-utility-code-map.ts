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

export interface NativeRealUtilityTargetModule extends NativeCodeModule {
  executable?: boolean;
  executableRanges?: NativeRealUtilityExecutableRange[];
}

export interface NativeRealUtilityModuleExpectation {
  sourcePath?: string;
  sourceLogicalName?: string;
  targetModuleId?: string;
  targetPath?: string;
  expectedTargetBuildId?: string;
}

export interface NativeRealUtilityDeferredActiveSyscallLanding {
  threadId: string;
  sourceAddress: string;
  targetAddress: string;
  syscallClass: NativeActiveSyscallContinuation["syscallClass"];
  action: NativeActiveSyscallContinuation["action"];
  syscall: NativeActiveSyscallContinuation["syscall"];
  metadata: NativeActiveSyscallContinuation["metadata"];
}

export interface NativeRealUtilityResolvedLocation {
  threadId: string;
  sourceModule: NativeRealUtilitySourceModule;
  targetModule: NativeRealUtilityTargetModule;
  sourceRva: string;
  targetAddress: string;
  codeLocation: NativeCodeLocationMapping;
  deferredActiveSyscallLanding?: NativeRealUtilityDeferredActiveSyscallLanding;
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
  const rvaRefusal = validateTargetRva(match.targetModule, sourceRva);
  if (rvaRefusal) {
    return { refusal: rvaRefusal };
  }
  const targetAddress = BigInt(match.targetModule.loadBias) + sourceRva;
  const codeLocation: NativeCodeLocationMapping = {
    id: `code:${thread.id}:pc`,
    sourceMapping: sourceModule.textMapping,
    sourceAddress: hex(sourcePc),
    targetAddress: hex(targetAddress),
    state: "mapped",
  };
  return {
    threadId: thread.id,
    sourceModule,
    targetModule: match.targetModule,
    sourceRva: hex(sourceRva),
    targetAddress: hex(targetAddress),
    codeLocation,
    deferredActiveSyscallLanding: deferredContinuation
      ? deferredLanding(thread, deferredContinuation, sourcePc, targetAddress)
      : undefined,
  };
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

function deferredLanding(
  thread: NativeThreadState,
  continuation: NativeActiveSyscallContinuation,
  sourcePc: bigint,
  targetAddress: bigint,
): NativeRealUtilityDeferredActiveSyscallLanding {
  return {
    threadId: thread.id,
    sourceAddress: hex(sourcePc),
    targetAddress: hex(targetAddress),
    syscallClass: continuation.syscallClass,
    action: continuation.action,
    syscall: continuation.syscall,
    metadata: continuation.metadata,
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
