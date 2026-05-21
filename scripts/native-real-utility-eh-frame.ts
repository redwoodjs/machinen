#!/usr/bin/env tsx
import type { NativeProcessImageDocuments } from "../packages/runtime/src/native-process-image.ts";
import {
  discoverNativeUnwindFrames,
  nativeUnwindReturnAddressSlot,
  parseNativeEhFrameText,
  type NativeUnwindFrameRule,
} from "../packages/runtime/src/native-unwind-frames.ts";
import {
  NATIVE_CAPTURE_SOURCE,
  NATIVE_DWARF_UNWIND_CONTINUATION_SOURCE,
  NATIVE_PROCESS_IMAGE_BUNDLE_FILES,
  bundleFileStats,
  compileNativeDwarfUnwindContinuation,
  ensureSourcesExist,
  readSymbols,
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
import { finalJumpHex } from "./native-final-jump-utils.ts";
import {
  captureNativeArm64SourceBundle,
  readCapturedU64,
  type CapturedArm64SourceFacts,
} from "./native-captured-source-utils.ts";

const USAGE =
  "usage: tsx scripts/native-real-utility-eh-frame.ts [verify] [--out-dir path] [--json] [--keep]";
const ACTIVE_SYMBOL = "machinen_native_dwarf_unwind_active";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(args, "native-real-utility-eh-frame", ".eh_frame capture uses Linux ptrace/procfs");
    return;
  }
  if (process.arch !== "arm64") {
    emitSkip(
      args,
      "native-real-utility-eh-frame",
      "real utility .eh_frame proof currently captures an arm64 Linux source process",
    );
    return;
  }
  const workspace = createWorkspace(args, "machinen-native-real-utility-eh-frame-");
  try {
    emitResult(verifyRealUtilityEhFrame(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyRealUtilityEhFrame(outDir: string) {
  ensureSourcesExist([NATIVE_CAPTURE_SOURCE, NATIVE_DWARF_UNWIND_CONTINUATION_SOURCE]);
  const capture = captureNativeArm64SourceBundle({
    outDir,
    targetSource: NATIVE_DWARF_UNWIND_CONTINUATION_SOURCE,
    compileTarget: compileStrippedEhFrameFixture,
    resourceFileName: "native-real-utility-eh-frame-resource.txt",
    label: "native real utility .eh_frame source capture",
  });
  const rule = ehFrameRuleForCapturedPc(capture.target, capture.facts);
  const frame = discoverFrameFromEhFrame(rule, capture.facts, capture.sourceBundle);
  return {
    formatVersion: 1,
    phase: "real-utility-eh-frame",
    hostArch: "arm64",
    targetArch: "amd64",
    sourceBundleDir: capture.sourceBundleDir,
    capturer: capture.capturer,
    target: capture.target,
    strippedDebugInfo: true,
    pid: capture.sourceBundle.manifest.capture.pid,
    threadId: capture.facts.thread.id,
    capturedSourcePc: finalJumpHex(capture.facts.sourcePc),
    rule,
    discoveredFrame: frame,
    returnAddressSlot: frame.returnAddressSlot,
    returnAddress: frame.returnAddress,
    execution: "captured-arm64-source-frame-discovered-from-real-eh-frame",
    bundleFiles: bundleFileStats(capture.sourceBundleDir, NATIVE_PROCESS_IMAGE_BUNDLE_FILES),
  };
}

function compileStrippedEhFrameFixture(binDir: string) {
  const target = compileNativeDwarfUnwindContinuation(binDir);
  runCommand("strip", ["--strip-debug", target], {
    label: "strip debug info from eh_frame fixture",
  });
  return target;
}

function ehFrameRuleForCapturedPc(
  target: string,
  facts: CapturedArm64SourceFacts,
): NativeUnwindFrameRule {
  const symbols = readSymbols(target, [ACTIVE_SYMBOL]);
  const active = symbols.get(ACTIVE_SYMBOL);
  assert(active, `missing source symbol: ${ACTIVE_SYMBOL}`);
  const sourcePc = finalJumpHex(facts.sourcePc);
  const readelfFrames = runCommand("readelf", ["--debug-dump=frames", target], {
    label: "real utility .eh_frame scan",
  }).stdout;
  const parsed = parseNativeEhFrameText({
    readelfFrames,
    mapping: facts.textMapping.id,
    functionName: ACTIVE_SYMBOL,
    pc: sourcePc,
  });
  assert(
    parsed.refusals.length === 0,
    `real utility .eh_frame parser refused: ${JSON.stringify(parsed.refusals)}`,
  );
  const rule = parsed.rules[0];
  assert(rule, "real utility .eh_frame parser returned no rule");
  assert(BigInt(sourcePc) >= BigInt(active.address), "captured PC precedes active symbol");
  return rule;
}

function discoverFrameFromEhFrame(
  rule: NativeUnwindFrameRule,
  facts: CapturedArm64SourceFacts,
  sourceBundle: NativeProcessImageDocuments,
) {
  const returnAddressSlot = nativeUnwindReturnAddressSlot({
    rule,
    sourceRegisters: facts.thread.sourceRegisters,
  });
  assert(returnAddressSlot, ".eh_frame rule did not describe a stack return-address slot");
  const returnAddress = readCapturedU64(
    sourceBundle,
    facts.stackMapping,
    BigInt(returnAddressSlot),
  );
  const discovered = discoverNativeUnwindFrames({
    threadId: facts.thread.id,
    stackMapping: facts.stackMapping.id,
    sourceRegisters: facts.thread.sourceRegisters,
    rules: [rule],
    stackWords: [{ address: returnAddressSlot, value: finalJumpHex(returnAddress) }],
  });
  assert(
    discovered.refusals.length === 0,
    `real utility .eh_frame discovery refused: ${JSON.stringify(discovered.refusals)}`,
  );
  const frame = discovered.frames[0];
  assert(frame, "real utility .eh_frame discovery produced no frame");
  return frame;
}

function printSummary(
  summary: ReturnType<typeof verifyRealUtilityEhFrame> | { skipped: true; reason: string },
) {
  if ("skipped" in summary) {
    console.log(`native-real-utility-eh-frame: skipped ${summary.reason}`);
    return;
  }
  console.log(
    `native-real-utility-eh-frame: frame=${summary.discoveredFrame.functionName} return=${summary.returnAddress}`,
  );
  console.log(`native-real-utility-eh-frame: execution=${summary.execution}`);
}

main();
