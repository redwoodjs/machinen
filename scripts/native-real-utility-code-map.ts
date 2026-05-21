#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  inventoryNativeSourceCodeModules,
  resolveNativeRealUtilityCodeLocations,
  type NativeRealUtilitySourceModule,
  type NativeRealUtilityTargetModule,
} from "../packages/runtime/src/native-real-utility-code-map.ts";
import {
  validateNativeProcessImageBundle,
  type NativeProcessImageDocuments,
} from "../packages/runtime/src/native-process-image.ts";
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
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-real-utility-code-map.ts [verify] [--out-dir path] [--json] [--keep]";
const SETTLE_MS = "200";
const UTILITY_NAME = "sh";
const TARGET_LOAD_BIAS_BASE = 0x700000000000n;

type NativeRealUtilityCodeMapSummary =
  | ReturnType<typeof verifyRealUtilityCodeMap>
  | ReturnType<typeof outsideSyscallSkip>
  | ReturnType<typeof unsupportedHostSkip>;

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(args, "native-real-utility-code-map", "real utility capture uses Linux procfs");
    return;
  }
  if (process.arch !== "arm64") {
    emitSkip(
      args,
      "native-real-utility-code-map",
      "real utility code-map proof currently captures an arm64 Linux source utility",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-native-real-utility-code-map-");
  try {
    emitResult(run(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function run(outDir: string): NativeRealUtilityCodeMapSummary {
  if (hostArch() !== "arm64") {
    return unsupportedHostSkip();
  }
  const summary = verifyRealUtilityCodeMap(outDir);
  if (summary.threadSyscalls.some((syscall) => syscall.state !== "outside-syscall")) {
    return outsideSyscallSkip(summary.threadSyscalls);
  }
  return summary;
}

function verifyRealUtilityCodeMap(outDir: string) {
  const capture = captureRealUtility(outDir);
  return realUtilityCodeMapSummary(capture);
}

function captureRealUtility(outDir: string) {
  ensureSourcesExist([NATIVE_CAPTURE_SOURCE]);
  const binDir = join(outDir, "bin");
  const bundleDir = join(outDir, "real-utility-source-bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });

  const capturer = compileNativeProcessCapturer(binDir);
  const utility = requireUtility(["/bin/sh", "/usr/bin/sh", "/bin/bash", "/usr/bin/bash"]);
  const command = [utility, "-c", "while :; do :; done"];
  const capture = spawnSync(
    capturer,
    ["--output", bundleDir, "--target-arch", "amd64", "--settle-ms", SETTLE_MS, "--", ...command],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  assert(capture.status === 0, `real utility capture failed: ${capture.stderr}`);
  return { capturer, command, bundleDir, bundle: validateNativeProcessImageBundle(bundleDir) };
}

function realUtilityCodeMapSummary(capture: {
  capturer: string;
  command: string[];
  bundleDir: string;
  bundle: NativeProcessImageDocuments;
}) {
  const { bundle } = capture;
  const sourceModules = inventoryNativeSourceCodeModules(bundle);
  const executableModule = executableSourceModule(bundle, sourceModules);
  const targetModules = targetInventoryForProof(sourceModules);
  const targetModule = targetModuleForExecutable(executableModule, targetModules);
  const codeMap = resolveNativeRealUtilityCodeLocations({
    documents: bundle,
    targetArch: "amd64",
    targetModules,
    moduleExpectations: [
      {
        sourcePath: executableModule.path,
        targetModuleId: targetModule.id,
        expectedTargetBuildId: targetModule.buildId,
      },
    ],
  });
  assertOnlyActiveSyscallRefusals(codeMap.refusals);
  const mapped = codeMap.resolved[0];
  return {
    formatVersion: 1,
    phase: "real-utility-code-map",
    hostArch: "arm64",
    targetArch: "amd64",
    utility: UTILITY_NAME,
    command: capture.command,
    capturer: capture.capturer,
    bundleDir: capture.bundleDir,
    pid: bundle.manifest.capture.pid,
    executable: bundle.manifest.process.exe,
    sourceModules: sourceModules.map(moduleSummary),
    targetModules: targetModules.map(moduleSummary),
    threadSyscalls: threadSyscalls(bundle),
    ...mappedSummary(mapped),
    refusals: codeMap.refusals,
    attemptedResume: false,
    sourceTextReusedAsTargetCode: false,
    targetBinarySource: "explicit-module-inventory",
    bundleFiles: bundleFileStats(capture.bundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function mappedSummary(
  mapped: ReturnType<typeof resolveNativeRealUtilityCodeLocations>["resolved"][number] | undefined,
) {
  if (!mapped) {
    return {
      mappedLocation: undefined,
      sourceRva: undefined,
      targetAddress: undefined,
      execution: "real-arm64-utility-pc-refused-before-module-rva",
    };
  }
  return {
    mappedLocation: mapped.codeLocation,
    sourceRva: mapped.sourceRva,
    targetAddress: mapped.targetAddress,
    execution: "real-arm64-utility-pc-mapped-to-amd64-module-rva",
  };
}

function executableSourceModule(
  bundle: NativeProcessImageDocuments,
  sourceModules: NativeRealUtilitySourceModule[],
) {
  const executableModule = sourceModules.find(
    (module) => module.path === bundle.manifest.process.exe,
  );
  assert(executableModule, "real utility capture did not include executable module text");
  return executableModule;
}

function targetModuleForExecutable(
  executableModule: NativeRealUtilitySourceModule,
  targetModules: NativeRealUtilityTargetModule[],
) {
  const targetModule = targetModules.find(
    (module) => module.logicalName === executableModule.logicalName,
  );
  assert(targetModule, "proof target inventory did not include utility executable");
  return targetModule;
}

function assertOnlyActiveSyscallRefusals(refusals: Array<{ code: string }>) {
  assert(
    refusals.every((refusal) => refusal.code === "active-syscall"),
    `real utility code map refused unexpectedly: ${JSON.stringify(refusals)}`,
  );
}

function threadSyscalls(bundle: NativeProcessImageDocuments) {
  return bundle.threads.threads.map((thread) => ({
    id: thread.id,
    state: thread.syscall.state,
    number: thread.syscall.number,
    name: thread.syscall.name,
  }));
}

function targetInventoryForProof(
  sourceModules: NativeRealUtilitySourceModule[],
): NativeRealUtilityTargetModule[] {
  return sourceModules.map((sourceModule, index) => {
    const loadBias = TARGET_LOAD_BIAS_BASE + BigInt(index) * 0x1000000n;
    const relativeStart = BigInt(sourceModule.sourceStart) - BigInt(sourceModule.loadBias);
    const relativeEnd = BigInt(sourceModule.sourceEnd) - BigInt(sourceModule.loadBias);
    return {
      id: `target:${sourceModule.id}`,
      logicalName: sourceModule.logicalName,
      path: `/target${sourceModule.path}`,
      arch: "amd64",
      kind: sourceModule.kind === "vdso" ? "shared-object" : sourceModule.kind,
      buildId: `target-${sourceModule.buildId}`,
      loadBias: hex(loadBias),
      textMapping: `target:${sourceModule.textMapping}`,
      executable: true,
      executableRanges: [{ relativeStart: hex(relativeStart), relativeEnd: hex(relativeEnd) }],
    };
  });
}

function outsideSyscallSkip(threadSyscalls: Array<{ state: string }>) {
  return {
    skipped: true,
    reason: "real utility was sampled inside a syscall; #492 refusal ordering owns that boundary",
    threadSyscalls,
  };
}

function unsupportedHostSkip() {
  return { skipped: true, reason: `unsupported host architecture: ${process.arch}` };
}

function requireUtility(paths: string[]) {
  const utility = paths.find((path) => existsSync(path) && statSync(path).isFile());
  assert(utility, `${UTILITY_NAME} utility not found`);
  return utility;
}

function moduleSummary(module: NativeRealUtilitySourceModule | NativeRealUtilityTargetModule) {
  return {
    id: module.id,
    logicalName: module.logicalName,
    path: module.path,
    arch: module.arch,
    kind: module.kind,
    buildId: module.buildId,
    loadBias: module.loadBias,
    textMapping: module.textMapping,
  };
}

function printSummary(summary: NativeRealUtilityCodeMapSummary) {
  if ("skipped" in summary) {
    console.log(`native-real-utility-code-map: skipped ${summary.reason}`);
    return;
  }
  console.log(
    `native-real-utility-code-map: utility=${summary.utility} mapped=${summary.mappedLocation?.state ?? "none"} refusals=${summary.refusals.length}`,
  );
  console.log(`native-real-utility-code-map: execution=${summary.execution}`);
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

main();
