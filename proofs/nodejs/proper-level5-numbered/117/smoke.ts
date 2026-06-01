#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type Thread = {
  id: string;
  role: "main" | "worker" | "platform";
  idle: boolean;
  sharedArrayBuffer: boolean;
};
function classify(threads: Thread[]): {
  accepted: boolean;
  targetStarted: boolean;
  classification?: Record<string, string>;
  refusal?: { code: string; threadId: string };
} {
  const classification: Record<string, string> = {};
  for (const thread of threads) {
    classification[thread.id] = thread.role;
    if (thread.role === "worker") {
      return {
        accepted: false,
        targetStarted: false,
        classification,
        refusal: { code: "node-proper-level5-worker-thread-unsupported", threadId: thread.id },
      };
    }
    if (!thread.idle) {
      return {
        accepted: false,
        targetStarted: false,
        classification,
        refusal: { code: "node-proper-level5-thread-not-idle", threadId: thread.id },
      };
    }
    if (thread.sharedArrayBuffer) {
      return {
        accepted: false,
        targetStarted: false,
        classification,
        refusal: { code: "node-proper-level5-shared-array-buffer-refused", threadId: thread.id },
      };
    }
  }
  return { accepted: true, targetStarted: false, classification };
}
function main(): void {
  const accepted = classify([
    { id: "main", role: "main", idle: true, sharedArrayBuffer: false },
    { id: "platform", role: "platform", idle: true, sharedArrayBuffer: false },
  ]);
  if (!accepted.accepted || accepted.targetStarted) {
    throw new Error(`thread classification refused: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, Thread[], string]> = [
    [
      "worker",
      [
        { id: "main", role: "main", idle: true, sharedArrayBuffer: false },
        { id: "worker-1", role: "worker", idle: true, sharedArrayBuffer: false },
      ],
      "node-proper-level5-worker-thread-unsupported",
    ],
    [
      "busy",
      [{ id: "main", role: "main", idle: false, sharedArrayBuffer: false }],
      "node-proper-level5-thread-not-idle",
    ],
    [
      "sab",
      [{ id: "main", role: "main", idle: true, sharedArrayBuffer: true }],
      "node-proper-level5-shared-array-buffer-refused",
    ],
  ];
  const refusedRows = cases.map(([id, threads, expectedCode]) => {
    const result = classify(threads);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} failed: ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.refusal.code,
      threadId: result.refusal.threadId,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-worker-thread-classification-summary",
    proof: "117",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      workerThreadClassificationRecorded: true,
      workerThreadsRefuseForNow: true,
      sharedArrayBufferRefused: true,
      targetNotStartedForUnsupportedThreads: refusedRows.every(
        (row) => row.targetStarted === false,
      ),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_117_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/117/checked-summary.json is stale; rerun with UPDATE_PROOF_117_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ refused: refusedRows.length }));
  console.log("proof 117 worker-thread classification passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
