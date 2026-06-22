/** Source-code to target-code mapping for native cross-ISA restore. */

import { buildNativeCodeMapNative } from "./native/native-code-map.ts";
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
  return buildNativeCodeMapNative(request);
}
