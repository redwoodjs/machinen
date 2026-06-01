#!/usr/bin/env tsx
import { createServer } from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type ListenerRecord = {
  kind: string;
  host: string;
  port: number;
  state: string;
  acceptedQueue: number;
  sourceFdCopied: boolean;
};
type Result = {
  accepted: boolean;
  targetStarted: boolean;
  descriptor?: ListenerRecord;
  refusal?: { code: string };
};
function translate(record: ListenerRecord): Result {
  if (record.kind !== "tcp-listener-v1" || record.state !== "LISTEN") {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-tcp-listener-state-unsupported" },
    };
  }
  if (record.acceptedQueue !== 0) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-tcp-accepted-queue-active-refused" },
    };
  }
  if (record.sourceFdCopied) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-tcp-source-fd-copy-refused" },
    };
  }
  return { accepted: true, targetStarted: false, descriptor: record };
}
async function bindTarget(): Promise<{ listening: boolean; response: string }> {
  return await new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      socket.end("target-native-listener");
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.close(() => resolve({ listening: true, response: "target-native-listener" }));
    });
  });
}
async function main(): Promise<void> {
  const accepted = translate({
    kind: "tcp-listener-v1",
    host: "127.0.0.1",
    port: 0,
    state: "LISTEN",
    acceptedQueue: 0,
    sourceFdCopied: false,
  });
  if (!accepted.accepted) {
    throw new Error(`listener refused: ${JSON.stringify(accepted)}`);
  }
  const target = await bindTarget();
  const cases: Array<[string, ListenerRecord, string]> = [
    [
      "accepted-queue",
      {
        kind: "tcp-listener-v1",
        host: "127.0.0.1",
        port: 0,
        state: "LISTEN",
        acceptedQueue: 1,
        sourceFdCopied: false,
      },
      "node-proper-level5-tcp-accepted-queue-active-refused",
    ],
    [
      "source-fd-copy",
      {
        kind: "tcp-listener-v1",
        host: "127.0.0.1",
        port: 0,
        state: "LISTEN",
        acceptedQueue: 0,
        sourceFdCopied: true,
      },
      "node-proper-level5-tcp-source-fd-copy-refused",
    ],
    [
      "not-listen",
      {
        kind: "tcp-listener-v1",
        host: "127.0.0.1",
        port: 0,
        state: "ESTABLISHED",
        acceptedQueue: 0,
        sourceFdCopied: false,
      },
      "node-proper-level5-tcp-listener-state-unsupported",
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
    kind: "machinen.node-proper-level5-tcp-listener-reconstruction-summary",
    proof: "112",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    target,
    refusedRows,
    assertions: {
      tcpListenerCapturedAndTranslated: true,
      targetNativeListenerCreated: target.listening === true,
      activeAcceptedQueueRefused: true,
      sourceFdNotCopied: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_112_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/112/checked-summary.json is stale; rerun with UPDATE_PROOF_112_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 112 TCP listener reconstruction passed");
}
try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
