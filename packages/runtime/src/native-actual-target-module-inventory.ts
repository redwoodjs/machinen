/** Target module inventory for actual captured real-utility paths. */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type { NativeProcessImageArchitecture } from "./native-process-image.ts";
import type {
  NativeRealUtilitySourceModule,
  NativeRealUtilityTargetModule,
} from "./native-real-utility-code-map.ts";

export interface NativeActualTargetModuleInventoryRequest {
  sourceModules: NativeRealUtilitySourceModule[];
  targetArch: NativeProcessImageArchitecture;
  targetRoot?: string;
  explicitTargetModulePath?: string;
  loadBiasBase?: string;
}

export interface NativeActualTargetModuleInventoryResult {
  targetModules: NativeRealUtilityTargetModule[];
}

const LOAD_BIAS_STRIDE = 0x1_0000_0000n;
const DEFAULT_LOAD_BIAS_BASE = 0x7000_0000_0000n;

const ARCH_TRIPLETS: Record<NativeProcessImageArchitecture, string> = {
  arm64: "aarch64-linux-gnu",
  amd64: "x86_64-linux-gnu",
};

const LOADER_CANDIDATES: Record<NativeProcessImageArchitecture, string[]> = {
  arm64: [
    "/lib/ld-linux-aarch64.so.1",
    "/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1",
    "/usr/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1",
  ],
  amd64: [
    "/lib64/ld-linux-x86-64.so.2",
    "/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2",
    "/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2",
  ],
};

export function inventoryNativeActualTargetModules(
  request: NativeActualTargetModuleInventoryRequest,
): NativeActualTargetModuleInventoryResult {
  if (!request.targetRoot && !request.explicitTargetModulePath) {
    return { targetModules: [] };
  }

  const targetModules: NativeRealUtilityTargetModule[] = [];
  for (const source of request.sourceModules) {
    const target = targetModuleForSource(source, request, targetModules.length);
    if (target) {
      targetModules.push(target);
    }
  }
  return { targetModules };
}

function targetModuleForSource(
  source: NativeRealUtilitySourceModule,
  request: NativeActualTargetModuleInventoryRequest,
  index: number,
): NativeRealUtilityTargetModule | undefined {
  const targetPath = candidateTargetPaths(source, request).find((path) =>
    existsSync(resolveTargetPath(request.targetRoot, path)),
  );
  if (!targetPath) {
    return undefined;
  }

  const resolvedPath = resolveTargetPath(request.targetRoot, targetPath);
  const bytes = readFileSync(resolvedPath);
  return {
    id: `target:${source.id}`,
    logicalName: basename(targetPath),
    path: targetPath,
    arch: request.targetArch,
    kind: source.kind,
    buildId: sha256(bytes),
    loadBias: targetLoadBias(request, index),
    textMapping: `target:${source.textMapping}`,
    executable: true,
    executableRanges: [{ relativeStart: "0x0", relativeEnd: hex(BigInt(bytes.byteLength)) }],
  };
}

function candidateTargetPaths(
  source: NativeRealUtilitySourceModule,
  request: NativeActualTargetModuleInventoryRequest,
): string[] {
  const paths: string[] = [];
  if (request.explicitTargetModulePath && executableSourceModule(source)) {
    paths.push(request.explicitTargetModulePath);
  }

  if (!request.targetRoot) {
    return unique(paths);
  }

  paths.push(...dynamicLoaderCandidates(source, request.targetArch));

  const sourceTriplet = ARCH_TRIPLETS[source.arch];
  const targetTriplet = ARCH_TRIPLETS[request.targetArch];
  if (sourceTriplet !== targetTriplet && source.path.includes(sourceTriplet)) {
    paths.push(source.path.replace(sourceTriplet, targetTriplet));
  }

  if (executableSourceModule(source)) {
    paths.push(source.path);
  }

  if (source.kind === "shared-object") {
    const name = basename(source.path);
    paths.push(`/usr/lib/${targetTriplet}/${name}`);
    paths.push(`/lib/${targetTriplet}/${name}`);
    paths.push(`/lib64/${name}`);
  }

  return unique(paths);
}

function dynamicLoaderCandidates(
  source: NativeRealUtilitySourceModule,
  targetArch: NativeProcessImageArchitecture,
): string[] {
  if (!isDynamicLoader(source.path)) {
    return [];
  }
  return LOADER_CANDIDATES[targetArch];
}

function executableSourceModule(source: NativeRealUtilitySourceModule): boolean {
  return source.kind === "pie-executable" || source.kind === "executable";
}

function isDynamicLoader(path: string): boolean {
  const name = basename(path);
  return name.startsWith("ld-linux") || name === "ld.so";
}

function resolveTargetPath(targetRoot: string | undefined, modulePath: string): string {
  if (!targetRoot) {
    return modulePath;
  }
  return join(targetRoot, isAbsolute(modulePath) ? modulePath.slice(1) : modulePath);
}

function targetLoadBias(request: NativeActualTargetModuleInventoryRequest, index: number): string {
  const base = request.loadBiasBase ? BigInt(request.loadBiasBase) : DEFAULT_LOAD_BIAS_BASE;
  return hex(base + BigInt(index) * LOAD_BIAS_STRIDE);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
