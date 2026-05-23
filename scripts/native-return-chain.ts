#!/usr/bin/env tsx
import { planNativeReturnChain } from "../packages/runtime/src/native-return-chain.ts";
import {
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-return-chain.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-native-return-chain-");
  try {
    emitResult(verifyNativeReturnChain(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyNativeReturnChain() {
  const result = planNativeReturnChain({
    targetStackBase: "0x50000000f000",
    targetStackLimit: "0x500000010000",
    maxFrames: 4,
    frames: [
      {
        id: "frame:leaf-caller",
        framePointer: "0x50000000ff00",
        canonicalFrameAddress: "0x50000000ff10",
        returnAddressSlot: "0x50000000ff08",
        returnAddress: "0x700300000316",
        unwindId: "target:leaf-caller@v1",
        callerFramePointer: "0x50000000ff40",
      },
      {
        id: "frame:main",
        framePointer: "0x50000000ff40",
        canonicalFrameAddress: "0x50000000ff50",
        returnAddressSlot: "0x50000000ff48",
        returnAddress: "0x700300000500",
        unwindId: "target:main@v1",
      },
    ],
  });
  if (
    result.state !== "materialized" ||
    result.frames.length !== 2 ||
    result.refusals.length !== 0
  ) {
    throw new Error("native return-chain proof did not materialize a bounded two-frame chain");
  }
  return { formatVersion: 1, result };
}

function printSummary(summary: ReturnType<typeof verifyNativeReturnChain>) {
  console.log(
    `native-return-chain: state=${summary.result.state} frames=${summary.result.frames.length} refusals=${summary.result.refusals.length}`,
  );
}

main();
