/** Source-code to target-code mapping for native cross-ISA restore. */

import type {
  NativeCodeLocationMapping,
  NativeProcessImageRefusal,
} from "./native-process-image.ts";

export interface NativeCodeSymbol {
  name: string;
  mapping: string;
  address: string;
  sizeBytes?: number;
  buildId?: string;
  metadata: "symbol" | "dwarf" | "sidecar";
}

export interface NativeCodeMapRequest {
  expectedTargetBuildId: string;
  targetBuildId: string;
  sourceSymbols: NativeCodeSymbol[];
  targetSymbols: NativeCodeSymbol[];
  requestedLocations: Array<{ id: string; symbol: string; sourceAddress?: string }>;
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
  const codeLocations = request.requestedLocations.map((location) =>
    mapRequestedLocation(location, sourceByName, targetByName),
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

function mapRequestedLocation(
  location: NativeCodeMapRequest["requestedLocations"][number],
  sourceByName: Map<string, NativeCodeSymbol>,
  targetByName: Map<string, NativeCodeSymbol>,
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
  if (
    source.metadata === "symbol" &&
    target.metadata === "symbol" &&
    source.sizeBytes === undefined
  ) {
    return refusedLocation(
      location,
      codeRefusal(
        "code-location-unknown",
        `symbol ${location.symbol} needs DWARF or sidecar size metadata before pointer translation`,
      ),
      source,
    );
  }
  return {
    id: location.id,
    sourceMapping: source.mapping,
    sourceAddress: location.sourceAddress ?? source.address,
    targetAddress: target.address,
    state: "mapped",
  };
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
