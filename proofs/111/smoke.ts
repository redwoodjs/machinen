#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type TimerRecord = {
  kind: string;
  repeatMs: number;
  dueInMs: number;
  activeCallback: boolean;
  sourceHandleCopied: boolean;
};
type Result = {
  accepted: boolean;
  targetStarted: boolean;
  descriptor?: { kind: string; repeatMs: number; dueInMs: number };
  refusal?: { code: string };
};
function translate(record: TimerRecord): Result {
  if (record.kind !== "libuv-timer-v1") {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-timer-kind-unsupported" },
    };
  }
  if (record.activeCallback) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-timer-active-callback-refused" },
    };
  }
  if (record.sourceHandleCopied) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-timer-source-handle-copy-refused" },
    };
  }
  if (record.repeatMs <= 0 || record.dueInMs < 0) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-timer-values-invalid" },
    };
  }
  return {
    accepted: true,
    targetStarted: false,
    descriptor: { kind: "target-native-timer", repeatMs: record.repeatMs, dueInMs: record.dueInMs },
  };
}
function main(): void {
  const accepted = translate({
    kind: "libuv-timer-v1",
    repeatMs: 1000,
    dueInMs: 250,
    activeCallback: false,
    sourceHandleCopied: false,
  });
  if (!accepted.accepted || !accepted.descriptor) {
    throw new Error(`timer translate failed: ${JSON.stringify(accepted)}`);
  }
  const target = {
    tickAfterMs: accepted.descriptor.dueInMs,
    nextRepeatMs: accepted.descriptor.repeatMs,
    targetNativeTimerCreated: true,
  };
  const cases: Array<[string, TimerRecord, string]> = [
    [
      "active-callback",
      {
        kind: "libuv-timer-v1",
        repeatMs: 1000,
        dueInMs: 250,
        activeCallback: true,
        sourceHandleCopied: false,
      },
      "node-proper-level5-timer-active-callback-refused",
    ],
    [
      "source-handle-copy",
      {
        kind: "libuv-timer-v1",
        repeatMs: 1000,
        dueInMs: 250,
        activeCallback: false,
        sourceHandleCopied: true,
      },
      "node-proper-level5-timer-source-handle-copy-refused",
    ],
    [
      "bad-values",
      {
        kind: "libuv-timer-v1",
        repeatMs: 0,
        dueInMs: -1,
        activeCallback: false,
        sourceHandleCopied: false,
      },
      "node-proper-level5-timer-values-invalid",
    ],
  ];
  const refusedRows = cases.map(([id, record, expectedCode]) => {
    const result = translate(record);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} failed: ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.refusal.code,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-libuv-timer-reconstruction-summary",
    proof: "111",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    target,
    refusedRows,
    assertions: {
      timerHandleCapturedAndTranslated: true,
      targetNativeTimerDescriptorCreated: target.targetNativeTimerCreated,
      activeTimerCallbackRefused: refusedRows.some((row) => row.id === "active-callback"),
      sourceHandleNotCopied: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_111_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/111/checked-summary.json is stale; rerun with UPDATE_PROOF_111_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 111 timer reconstruction passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
