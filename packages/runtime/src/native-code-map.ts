/** Source-code to target-code mapping for native cross-ISA restore. */

import type {
  NativeCodeLocationMapping,
  NativeProcessImageArchitecture,
  NativeProcessImageRefusal,
} from "./native-process-image.ts";

export interface NativeCodeModule {
  id: string;
  logicalName: string;
  path: string;
  arch?: NativeProcessImageArchitecture;
  kind: "executable" | "pie-executable" | "shared-object" | "vdso" | "unknown";
  buildId: string;
  loadBias: string;
  textMapping: string;
}

export interface NativeCodeSymbol {
  name: string;
  mapping: string;
  address: string;
  sizeBytes?: number;
  buildId?: string;
  metadata: "symbol" | "dwarf" | "sidecar";
  moduleId?: string;
  relativeAddress?: string;
}

export interface NativeCodeMapRequest {
  expectedTargetBuildId: string;
  targetBuildId: string;
  sourceSymbols: NativeCodeSymbol[];
  targetSymbols: NativeCodeSymbol[];
  requestedLocations: Array<{ id: string; symbol: string; sourceAddress?: string }>;
  sourceModules?: NativeCodeModule[];
  targetModules?: NativeCodeModule[];
}

export interface NativeCodeMapResult {
  codeLocations: NativeCodeLocationMapping[];
  refusals: NativeProcessImageRefusal[];
}

export function buildNativeCodeMap(request: NativeCodeMapRequest): NativeCodeMapResult {
  const buildMismatch = validateTargetBuild(request);
  if (buildMismatch) {
    return {
      codeLocations: request.requestedLocations.map((location) =>
        refusedLocation(location, buildMismatch),
      ),
      refusals: [buildMismatch],
    };
  }

  const sourceByName = symbolsByName(request.sourceSymbols);
  const targetByName = symbolsByName(request.targetSymbols);
  const sourceModules = modulesById(request.sourceModules ?? []);
  const targetModules = modulesById(request.targetModules ?? []);
  const codeLocations = request.requestedLocations.map((location) =>
    mapRequestedLocation(location, sourceByName, targetByName, sourceModules, targetModules),
  );
  return {
    codeLocations,
    refusals: codeLocations.flatMap((location) => (location.refusal ? [location.refusal] : [])),
  };
}

function validateTargetBuild(request: NativeCodeMapRequest): NativeProcessImageRefusal | undefined {
  if (normalizeBuildId(request.targetBuildId) !== normalizeBuildId(request.expectedTargetBuildId)) {
    return {
      code: "target-build-mismatch",
      message: `target build ${request.targetBuildId} does not match expected ${request.expectedTargetBuildId}`,
      detail: {
        targetBuildId: request.targetBuildId,
        expectedTargetBuildId: request.expectedTargetBuildId,
      },
    };
  }
  return undefined;
}

function symbolsByName(symbols: NativeCodeSymbol[]): Map<string, NativeCodeSymbol> {
  const byName = new Map<string, NativeCodeSymbol>();
  for (const symbol of symbols) {
    byName.set(symbol.name, symbol);
  }
  return byName;
}

function modulesById(modules: NativeCodeModule[]): Map<string, NativeCodeModule> {
  const byId = new Map<string, NativeCodeModule>();
  for (const codeModule of modules) {
    byId.set(codeModule.id, codeModule);
  }
  return byId;
}

function mapRequestedLocation(
  location: NativeCodeMapRequest["requestedLocations"][number],
  sourceByName: Map<string, NativeCodeSymbol>,
  targetByName: Map<string, NativeCodeSymbol>,
  sourceModules: Map<string, NativeCodeModule>,
  targetModules: Map<string, NativeCodeModule>,
): NativeCodeLocationMapping {
  const source = sourceByName.get(location.symbol);
  if (!source) {
    return refusedLocation(
      location,
      codeRefusal("code-location-unknown", `source symbol ${location.symbol} is missing`),
    );
  }
  const target = targetByName.get(location.symbol);
  if (!target) {
    return refusedLocation(
      location,
      codeRefusal("code-location-unknown", `target symbol ${location.symbol} is missing`),
      source,
    );
  }
  const metadataRefusal = validateSymbolMetadata(location.symbol, source, target);
  if (metadataRefusal) {
    return refusedLocation(location, metadataRefusal, source);
  }

  const targetAddress = resolveTargetAddress(
    location,
    source,
    target,
    sourceModules,
    targetModules,
  );
  if ("refusal" in targetAddress) {
    return refusedLocation(location, targetAddress.refusal, source);
  }
  return {
    id: location.id,
    sourceMapping: source.mapping,
    sourceAddress: location.sourceAddress ?? source.address,
    targetAddress: targetAddress.address,
    state: "mapped",
  };
}

function validateSymbolMetadata(
  symbol: string,
  source: NativeCodeSymbol,
  target: NativeCodeSymbol,
): NativeProcessImageRefusal | undefined {
  if (
    source.metadata === "symbol" &&
    target.metadata === "symbol" &&
    source.sizeBytes === undefined
  ) {
    return codeRefusal(
      "code-location-unknown",
      `symbol ${symbol} needs DWARF or sidecar size metadata before pointer translation`,
    );
  }
  return undefined;
}

function resolveTargetAddress(
  location: NativeCodeMapRequest["requestedLocations"][number],
  source: NativeCodeSymbol,
  target: NativeCodeSymbol,
  sourceModules: Map<string, NativeCodeModule>,
  targetModules: Map<string, NativeCodeModule>,
): { address: string; refusal?: undefined } | { refusal: NativeProcessImageRefusal } {
  const modules = resolveCodeModules(location.symbol, source, target, sourceModules, targetModules);
  if ("refusal" in modules) {
    return modules;
  }
  const targetBuildMismatch = validateTargetModuleBuild(
    location.symbol,
    target,
    modules.targetModule,
  );
  if (targetBuildMismatch) {
    return { refusal: targetBuildMismatch };
  }
  const offset = sourceOffsetWithinSymbol(location, source, modules.sourceModule);
  if ("refusal" in offset) {
    return offset;
  }
  const targetOffsetRefusal = validateTargetOffset(location.symbol, target, offset.bytes);
  if (targetOffsetRefusal) {
    return { refusal: targetOffsetRefusal };
  }
  return { address: moduleRelativeAddress(modules.targetModule, target, offset.bytes) };
}

function resolveCodeModules(
  symbol: string,
  source: NativeCodeSymbol,
  target: NativeCodeSymbol,
  sourceModules: Map<string, NativeCodeModule>,
  targetModules: Map<string, NativeCodeModule>,
):
  | { sourceModule?: NativeCodeModule; targetModule: NativeCodeModule }
  | { refusal: NativeProcessImageRefusal } {
  if (!source.moduleId && !target.moduleId) {
    return { targetModule: syntheticAbsoluteModule(target) };
  }
  if (!source.moduleId || !target.moduleId || !source.relativeAddress || !target.relativeAddress) {
    return {
      refusal: codeRefusal(
        "code-location-unknown",
        `symbol ${symbol} needs source and target module-relative addresses`,
      ),
    };
  }
  const sourceModule = sourceModules.get(source.moduleId);
  const targetModule = targetModules.get(target.moduleId);
  return sourceModule && targetModule
    ? { sourceModule, targetModule }
    : missingModuleRefusal(symbol, source.moduleId, target.moduleId, sourceModule);
}

function syntheticAbsoluteModule(target: NativeCodeSymbol): NativeCodeModule {
  return {
    id: "module:absolute-target",
    logicalName: "absolute-target",
    path: "absolute-target",
    kind: "unknown",
    buildId: target.buildId ?? "absolute-target",
    loadBias: "0x0",
    textMapping: target.mapping,
  };
}

function missingModuleRefusal(
  symbol: string,
  sourceModuleId: string,
  targetModuleId: string,
  sourceModule: NativeCodeModule | undefined,
): { refusal: NativeProcessImageRefusal } {
  const missing = sourceModule
    ? `target module ${targetModuleId}`
    : `source module ${sourceModuleId}`;
  return {
    refusal: codeRefusal("code-location-unknown", `${missing} is missing for ${symbol}`),
  };
}

function sourceOffsetWithinSymbol(
  location: NativeCodeMapRequest["requestedLocations"][number],
  source: NativeCodeSymbol,
  sourceModule: NativeCodeModule | undefined,
): { bytes: bigint } | { refusal: NativeProcessImageRefusal } {
  if (!sourceModule || !source.relativeAddress) {
    return { bytes: 0n };
  }
  const sourceAddress = BigInt(location.sourceAddress ?? source.address);
  const sourceSymbolAddress = BigInt(sourceModule.loadBias) + BigInt(source.relativeAddress);
  if (sourceAddress < sourceSymbolAddress) {
    return {
      refusal: codeRefusal(
        "code-location-unknown",
        `source address ${location.sourceAddress ?? source.address} precedes symbol ${location.symbol}`,
      ),
    };
  }
  const bytes = sourceAddress - sourceSymbolAddress;
  return validateSourceOffset(location, source, bytes) ?? { bytes };
}

function validateSourceOffset(
  location: NativeCodeMapRequest["requestedLocations"][number],
  source: NativeCodeSymbol,
  offset: bigint,
): { refusal: NativeProcessImageRefusal } | undefined {
  if (source.sizeBytes === undefined || offset < BigInt(source.sizeBytes)) {
    return undefined;
  }
  return {
    refusal: codeRefusal(
      "code-location-unknown",
      `source address ${location.sourceAddress ?? source.address} is outside symbol ${location.symbol}`,
    ),
  };
}

function validateTargetOffset(
  symbol: string,
  target: NativeCodeSymbol,
  offset: bigint,
): NativeProcessImageRefusal | undefined {
  if (target.sizeBytes === undefined || offset < BigInt(target.sizeBytes)) {
    return undefined;
  }
  return codeRefusal(
    "code-location-unknown",
    `target symbol ${symbol} is smaller than the captured source offset`,
  );
}

function moduleRelativeAddress(
  targetModule: NativeCodeModule,
  target: NativeCodeSymbol,
  offset: bigint,
): string {
  if (!target.relativeAddress) {
    return target.address;
  }
  return hex(BigInt(targetModule.loadBias) + BigInt(target.relativeAddress) + offset);
}

function validateTargetModuleBuild(
  symbol: string,
  target: NativeCodeSymbol,
  targetModule: NativeCodeModule,
): NativeProcessImageRefusal | undefined {
  const expected = target.buildId;
  if (expected && normalizeBuildId(targetModule.buildId) !== normalizeBuildId(expected)) {
    return {
      code: "target-build-mismatch",
      message: `target module ${targetModule.logicalName} build ${targetModule.buildId} does not match expected ${expected} for ${symbol}`,
      detail: {
        symbol,
        targetModule: targetModule.id,
        targetBuildId: targetModule.buildId,
        expectedTargetBuildId: expected,
      },
    };
  }
  return undefined;
}

function refusedLocation(
  location: NativeCodeMapRequest["requestedLocations"][number],
  refusal: NativeProcessImageRefusal,
  source?: NativeCodeSymbol,
): NativeCodeLocationMapping {
  return {
    id: location.id,
    sourceMapping: source?.mapping ?? "mapping:unknown",
    sourceAddress: location.sourceAddress ?? source?.address ?? "0x0",
    state: "refused",
    refusal,
  };
}

function codeRefusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeProcessImageRefusal {
  return { code, message };
}

function normalizeBuildId(value: string): string {
  return value.toLowerCase();
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
