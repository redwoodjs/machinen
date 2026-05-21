#!/usr/bin/env tsx
import { planNativeRealUtilityContinuationAttempt } from "../packages/runtime/src/native-real-utility-continuation.ts";
import {
  matchNativeTargetUnwindFrame,
  parseNativeTargetEhFrameText,
} from "../packages/runtime/src/native-target-unwind.ts";
import type { NativeDiscoveredUnwindFrame } from "../packages/runtime/src/native-unwind-frames.ts";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-real-utility-target-unwind.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-real-utility-target-unwind-");
  try {
    emitResult(verifyTargetUnwindMatch(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyTargetUnwindMatch() {
  const sourceFrame = proofSourceFrame();
  const targetAddress = "0x700000001234";
  const parsed = parseNativeTargetEhFrameText({
    readelfFrames: targetReadelfFrames(),
    mapping: "target:mapping:realspin-text",
    functionName: "realspin_loop",
    targetAddress,
  });
  assert(
    parsed.refusals.length === 0,
    `target .eh_frame parse refused: ${JSON.stringify(parsed.refusals)}`,
  );
  const targetUnwind = matchNativeTargetUnwindFrame({
    sourceFrame,
    targetAddress,
    targetRules: parsed.rules,
  });
  assert(
    targetUnwind.refusals.length === 0,
    `target unwind match refused: ${JSON.stringify(targetUnwind.refusals)}`,
  );
  const plan = planNativeRealUtilityContinuationAttempt({
    codeLocations: [
      {
        id: "code:thread:pc",
        sourceMapping: "mapping:realspin-text",
        sourceAddress: sourceFrame.sourcePc,
        targetAddress,
        state: "mapped",
      },
    ],
    sourceFrames: [sourceFrame],
    targetUnwind,
  });
  assert(
    plan.state === "ready",
    `target unwind match did not unblock planner: ${JSON.stringify(plan)}`,
  );
  return {
    formatVersion: 1,
    phase: "real-utility-target-unwind",
    targetAddress,
    sourceFrame,
    targetRule: parsed.rules[0],
    targetUnwind,
    plan,
    attemptedResume: false,
    sourceTextReusedAsTargetCode: false,
    execution: "real-utility-target-unwind-matched-by-amd64-eh-frame",
  };
}

function proofSourceFrame(): NativeDiscoveredUnwindFrame {
  return {
    id: "frame:thread:realspin_loop",
    functionName: "realspin_loop",
    sourcePc: "0x401234",
    sourceSp: "0x7fff0000",
    cfa: "0x7fff0040",
    returnAddress: "0x401280",
    returnAddressSlot: "0x7fff0038",
    metadata: "eh-frame",
    stackFrame: {
      id: "frame:thread:realspin_loop",
      sourceSp: "0x7fff0000",
      sourceReturnAddress: "0x401280",
      sizeBytes: 64,
      metadata: "dwarf",
      locals: [],
    },
  };
}

function targetReadelfFrames() {
  return `
00000088 0000000000000024 0000001c FDE cie=00000070 pc=0000700000001200..0000700000001280
  DW_CFA_advance_loc: 1 to 0000700000001201
  DW_CFA_def_cfa_offset: 16
  DW_CFA_offset: r6 (rbp) at cfa-16
  DW_CFA_offset: r16 (rip) at cfa-8
  DW_CFA_advance_loc: 3 to 0000700000001204
  DW_CFA_def_cfa_register: r6 (rbp)
`;
}

function printSummary(summary: ReturnType<typeof verifyTargetUnwindMatch>) {
  console.log(
    `native-real-utility-target-unwind: state=${summary.plan.state} matches=${summary.targetUnwind.matches.length}`,
  );
  console.log(`native-real-utility-target-unwind: execution=${summary.execution}`);
}

main();
