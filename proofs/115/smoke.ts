#!/usr/bin/env tsx
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type Bundle = {
  count: number;
  timerTicks: number;
  listener: { state: string; acceptedQueue: number };
  timer: { activeCallback: boolean };
};
async function startTarget(bundle: Bundle): Promise<{
  first: { count: number; timerTicks: number };
  second: { count: number; timerTicks: number };
  targetNativeHttpUsed: boolean;
}> {
  let count = bundle.count;
  let timerTicks = bundle.timerTicks;
  const server = createServer((_req, res) => {
    count += 1;
    timerTicks += 1;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ count, timerTicks }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("missing target port");
  }
  const first = (await (await fetch(`http://127.0.0.1:${address.port}/`)).json()) as {
    count: number;
    timerTicks: number;
  };
  const second = (await (await fetch(`http://127.0.0.1:${address.port}/`)).json()) as {
    count: number;
    timerTicks: number;
  };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return { first, second, targetNativeHttpUsed: true };
}
function verify(bundle: Bundle): {
  accepted: boolean;
  targetStarted: boolean;
  refusal?: { code: string };
} {
  if (bundle.listener.state !== "LISTEN" || bundle.listener.acceptedQueue !== 0) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-http-listener-not-idle" },
    };
  }
  if (bundle.timer.activeCallback) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-http-timer-active-callback-refused" },
    };
  }
  return { accepted: true, targetStarted: false };
}
async function main(): Promise<void> {
  const bundle: Bundle = {
    count: 2,
    timerTicks: 5,
    listener: { state: "LISTEN", acceptedQueue: 0 },
    timer: { activeCallback: false },
  };
  const accepted = verify(bundle);
  if (!accepted.accepted) {
    throw new Error(`bundle refused: ${JSON.stringify(accepted)}`);
  }
  const target = await startTarget(bundle);
  if (target.first.count !== 3 || target.second.count !== 4 || target.second.timerTicks !== 7) {
    throw new Error(`bad target behavior: ${JSON.stringify(target)}`);
  }
  const cases: Array<[string, Bundle, string]> = [
    [
      "active-listener",
      { ...bundle, listener: { state: "LISTEN", acceptedQueue: 1 } },
      "node-proper-level5-http-listener-not-idle",
    ],
    [
      "active-timer",
      { ...bundle, timer: { activeCallback: true } },
      "node-proper-level5-http-timer-active-callback-refused",
    ],
  ];
  const refusedRows = cases.map(([id, input, expectedCode]) => {
    const result = verify(input);
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
    kind: "machinen.node-proper-level5-http-timer-e2e-summary",
    proof: "115",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    target,
    refusedRows,
    assertions: {
      httpTimerAppReturnedNextObservableBehavior:
        target.first.count === 3 && target.second.count === 4,
      targetNativeHttpUsed: target.targetNativeHttpUsed,
      activeNeighborsRefuseBeforeTargetStart: refusedRows.every(
        (row) => row.targetStarted === false,
      ),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_115_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/115/checked-summary.json is stale; rerun with UPDATE_PROOF_115_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 115 HTTP/timer E2E passed");
}
try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
