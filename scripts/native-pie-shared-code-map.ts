#!/usr/bin/env tsx
import { basename } from "node:path";
import {
  buildNativeCodeMap,
  type NativeCodeModule,
  type NativeCodeSymbol,
} from "../packages/runtime/src/native-code-map.ts";
import {
  validateNativeProcessImageBundle,
  type NativeMemoryMapping,
  type NativeProcessImageDocuments,
  type NativeRegisterState,
} from "../packages/runtime/src/native-process-image.ts";
import {
  NATIVE_CAPTURE_SOURCE,
  NATIVE_PIE_SHARED_LIB_SOURCE,
  NATIVE_PIE_SHARED_MAIN_SOURCE,
  compileNativePieSharedTarget,
  compileNativeProcessCapturer,
  createProofBinAndBundleDirs,
  ensureSourcesExist,
  hostArch,
  readSymbols,
  sha256File,
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

const USAGE =
  "usage: tsx scripts/native-pie-shared-code-map.ts [verify] [--out-dir path] [--json] [--keep]";
const SHARED_SYMBOL = "machinen_native_pie_shared_spin";
const SOURCE_MODULE_ID = "module:source-shared-lib";
const TARGET_MODULE_ID = "module:target-shared-lib";
const TARGET_LOAD_BIAS = 0x7f3300000000n;

type NativePieSharedCodeMapSummary =
  | ReturnType<typeof verifyNativePieSharedCodeMap>
  | ReturnType<typeof unsupportedHostSkip>;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "native-pie-shared-code-map",
      "PIE/shared-library capture uses Linux ptrace/procfs",
    );
    return;
  }
  const workspace = createWorkspace(args, "machinen-native-pie-shared-code-map-");
  try {
    emitResult(run(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function run(outDir: string): NativePieSharedCodeMapSummary {
  if (hostArch() !== "arm64" && hostArch() !== "amd64") {
    return unsupportedHostSkip();
  }
  return verifyNativePieSharedCodeMap(outDir);
}

function unsupportedHostSkip() {
  return { skipped: true, reason: `unsupported host architecture: ${process.arch}` };
}

function verifyNativePieSharedCodeMap(outDir: string) {
  ensureSourcesExist([
    NATIVE_CAPTURE_SOURCE,
    NATIVE_PIE_SHARED_MAIN_SOURCE,
    NATIVE_PIE_SHARED_LIB_SOURCE,
  ]);
  const { binDir, bundleDir } = createProofBinAndBundleDirs(outDir);

  const capturer = compileNativeProcessCapturer(binDir);
  const target = compileNativePieSharedTarget(binDir);
  runCommand(
    capturer,
    [
      "--output",
      bundleDir,
      "--target-arch",
      oppositeArch(hostArch()),
      "--settle-ms",
      "250",
      "--",
      target.executable,
    ],
    { label: "native PIE/shared-library source capture" },
  );

  const bundle = validateNativeProcessImageBundle(bundleDir);
  const sourcePc = capturedProgramCounter(bundle);
  const sharedMapping = executableMappingContaining(bundle, sourcePc);
  assert(
    sharedMapping.file?.path.endsWith(target.libraryName),
    `captured PC ${hex(sourcePc)} was not inside ${target.libraryName}`,
  );
  const pieMainMapping = findExecutableMappingForPath(bundle, target.executable);
  assert(pieMainMapping, "capture did not include the PIE executable text mapping");

  const sourceLoadBias = mappingLoadBias(sharedMapping);
  const symbols = readSymbols(target.library, [SHARED_SYMBOL]);
  const symbol = symbols.get(SHARED_SYMBOL);
  assert(symbol, `missing shared-library symbol: ${SHARED_SYMBOL}`);
  assert(symbol.sizeBytes > 0, `shared-library symbol ${SHARED_SYMBOL} has no size metadata`);
  const sourceSymbolAddress = sourceLoadBias + BigInt(symbol.address);
  assert(sourcePc >= sourceSymbolAddress, "captured PC precedes shared-library symbol");
  assert(
    sourcePc < sourceSymbolAddress + BigInt(symbol.sizeBytes),
    "captured PC is outside the shared-library symbol",
  );

  const targetBuildId = sha256File(target.library);
  const sourceModule = moduleForMapping({
    id: SOURCE_MODULE_ID,
    arch: hostArch(),
    buildId: sha256File(target.library),
    loadBias: sourceLoadBias,
    mapping: sharedMapping,
    kind: "shared-object",
  });
  const targetModule = moduleForMapping({
    id: TARGET_MODULE_ID,
    arch: oppositeArch(hostArch()),
    buildId: targetBuildId,
    loadBias: TARGET_LOAD_BIAS,
    mapping: sharedMapping,
    kind: "shared-object",
  });
  assert(
    sourceModule.loadBias !== targetModule.loadBias,
    "proof must use different source and target load biases",
  );

  const sourceSymbol = codeSymbol({
    mapping: sharedMapping.id,
    moduleId: SOURCE_MODULE_ID,
    address: hex(sourceSymbolAddress),
    relativeAddress: symbol.address,
    sizeBytes: symbol.sizeBytes,
    buildId: sourceModule.buildId,
  });
  const targetSymbol = codeSymbol({
    mapping: targetModule.textMapping,
    moduleId: TARGET_MODULE_ID,
    address: hex(TARGET_LOAD_BIAS + BigInt(symbol.address)),
    relativeAddress: symbol.address,
    sizeBytes: symbol.sizeBytes,
    buildId: targetBuildId,
  });
  const codeMap = buildNativeCodeMap({
    expectedTargetBuildId: targetBuildId,
    targetBuildId,
    sourceModules: [sourceModule],
    targetModules: [targetModule],
    sourceSymbols: [sourceSymbol],
    targetSymbols: [targetSymbol],
    requestedLocations: [
      { id: "code:pie-shared-spin", symbol: SHARED_SYMBOL, sourceAddress: hex(sourcePc) },
    ],
  });
  assert(codeMap.refusals.length === 0, "PIE/shared-library code map refused unexpectedly");
  const mappedLocation = codeMap.codeLocations[0];
  assert(mappedLocation?.state === "mapped", "PIE/shared-library location was not mapped");
  assert(
    mappedLocation.targetAddress !== mappedLocation.sourceAddress,
    "code map reused the source virtual address as a target address",
  );

  const mismatch = buildNativeCodeMap({
    expectedTargetBuildId: targetBuildId,
    targetBuildId,
    sourceModules: [sourceModule],
    targetModules: [{ ...targetModule, buildId: "bad-target-module-build" }],
    sourceSymbols: [sourceSymbol],
    targetSymbols: [targetSymbol],
    requestedLocations: [
      { id: "code:pie-shared-mismatch", symbol: SHARED_SYMBOL, sourceAddress: hex(sourcePc) },
    ],
  });
  assert(
    mismatch.refusals[0]?.code === "target-build-mismatch",
    "PIE/shared-library target module mismatch did not refuse precisely",
  );

  return {
    formatVersion: 1,
    phase: "pie-shared-code-map",
    hostArch: hostArch(),
    targetArch: oppositeArch(hostArch()),
    bundleDir,
    capturer,
    executable: target.executable,
    library: target.library,
    sourcePc: hex(sourcePc),
    symbol: SHARED_SYMBOL,
    sourceSymbolAddress: hex(sourceSymbolAddress),
    sourceSymbolRelativeAddress: symbol.address,
    sourceSymbolSizeBytes: symbol.sizeBytes,
    sourceModule,
    targetModule,
    pieExecutableMapping: mappingSummary(pieMainMapping),
    sharedLibraryMapping: mappingSummary(sharedMapping),
    mappedLocation,
    mismatchRefusal: mismatch.refusals[0],
    aslrIndependent: mappedLocation.targetAddress !== mappedLocation.sourceAddress,
    execution: "captured-pie-shared-library-pc-mapped-by-module-relative-address",
  };
}

function capturedProgramCounter(bundle: NativeProcessImageDocuments): bigint {
  const thread = bundle.threads.threads[0];
  assert(thread, "captured bundle has no thread");
  return registerProgramCounter(thread.sourceRegisters);
}

function registerProgramCounter(registers: NativeRegisterState): bigint {
  if (registers.arch === "arm64") {
    return BigInt(registers.pc);
  }
  return BigInt(registers.rip);
}

function executableMappingContaining(bundle: NativeProcessImageDocuments, address: bigint) {
  const mapping = bundle.mappings.mappings.find(
    (candidate) =>
      candidate.permissions.execute &&
      address >= BigInt(candidate.sourceStart) &&
      address < BigInt(candidate.sourceEnd),
  );
  assert(mapping, `no executable mapping contains ${hex(address)}`);
  return mapping;
}

function findExecutableMappingForPath(bundle: NativeProcessImageDocuments, path: string) {
  return bundle.mappings.mappings.find(
    (candidate) => candidate.permissions.execute && candidate.file?.path === path,
  );
}

function mappingLoadBias(mapping: NativeMemoryMapping): bigint {
  assert(mapping.file, `${mapping.id} does not have file metadata`);
  return BigInt(mapping.sourceStart) - BigInt(mapping.file.offset);
}

function moduleForMapping(options: {
  id: string;
  arch: string;
  buildId: string;
  loadBias: bigint;
  mapping: NativeMemoryMapping;
  kind: NativeCodeModule["kind"];
}): NativeCodeModule {
  const path = requiredMappingPath(options.mapping);
  return {
    id: options.id,
    logicalName: basename(path),
    path,
    arch: nativeModuleArch(options.arch),
    kind: options.kind,
    buildId: options.buildId,
    loadBias: hex(options.loadBias),
    textMapping: moduleTextMapping(options.id, options.mapping.id),
  };
}

function codeSymbol(options: Omit<NativeCodeSymbol, "metadata" | "name">): NativeCodeSymbol {
  return { name: SHARED_SYMBOL, metadata: "dwarf", ...options };
}

function requiredMappingPath(mapping: NativeMemoryMapping): string {
  assert(mapping.file, `${mapping.id} does not have file metadata`);
  return mapping.file.path;
}

function nativeModuleArch(arch: string): "arm64" | "amd64" {
  assert(arch === "arm64" || arch === "amd64", `unsupported module arch ${arch}`);
  return arch === "arm64" ? "arm64" : "amd64";
}

function moduleTextMapping(moduleId: string, sourceMappingId: string): string {
  if (moduleId === TARGET_MODULE_ID) {
    return "mapping:target-shared-lib-text";
  }
  return sourceMappingId;
}

function mappingSummary(mapping: NativeMemoryMapping) {
  return {
    id: mapping.id,
    kind: mapping.kind,
    path: mapping.file?.path,
    sourceStart: mapping.sourceStart,
    sourceEnd: mapping.sourceEnd,
    fileOffset: mapping.file?.offset,
    materialization: mapping.target.materialization,
  };
}

function oppositeArch(arch: string) {
  if (arch === "arm64") {
    return "amd64";
  }
  if (arch === "amd64") {
    return "arm64";
  }
  return "unknown";
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function printSummary(summary: NativePieSharedCodeMapSummary) {
  if ("skipped" in summary) {
    console.log(`native-pie-shared-code-map: skip — ${summary.reason}`);
    return;
  }
  console.log(
    `native-pie-shared-code-map: pc=${summary.sourcePc} sourceModule=${summary.sourceModule.loadBias} target=${summary.mappedLocation.targetAddress}`,
  );
  console.log(`native-pie-shared-code-map: execution=${summary.execution}`);
}

main();
