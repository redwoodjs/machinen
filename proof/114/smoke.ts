#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type WorkState = {
  id: string;
  pendingRequests: number;
  activeRequests: number;
  activeCallbacks: number;
  microtasksPending: boolean;
};
function classify(state: WorkState): {
  accepted: boolean;
  targetStarted: boolean;
  refusal?: { code: string };
} {
  if (state.activeRequests > 0) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-active-request-refused" },
    };
  }
  if (state.pendingRequests > 0) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-pending-request-refused" },
    };
  }
  if (state.activeCallbacks > 0) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-active-callback-refused" },
    };
  }
  if (state.microtasksPending) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-pending-microtask-refused" },
    };
  }
  return { accepted: true, targetStarted: false };
}
function main(): void {
  const idle = classify({
    id: "idle",
    pendingRequests: 0,
    activeRequests: 0,
    activeCallbacks: 0,
    microtasksPending: false,
  });
  if (!idle.accepted || idle.targetStarted) {
    throw new Error(`idle state refused: ${JSON.stringify(idle)}`);
  }
  const cases: Array<[WorkState, string]> = [
    [
      {
        id: "active-request",
        pendingRequests: 0,
        activeRequests: 1,
        activeCallbacks: 0,
        microtasksPending: false,
      },
      "node-proper-level5-active-request-refused",
    ],
    [
      {
        id: "pending-request",
        pendingRequests: 1,
        activeRequests: 0,
        activeCallbacks: 0,
        microtasksPending: false,
      },
      "node-proper-level5-pending-request-refused",
    ],
    [
      {
        id: "active-callback",
        pendingRequests: 0,
        activeRequests: 0,
        activeCallbacks: 1,
        microtasksPending: false,
      },
      "node-proper-level5-active-callback-refused",
    ],
    [
      {
        id: "pending-microtask",
        pendingRequests: 0,
        activeRequests: 0,
        activeCallbacks: 0,
        microtasksPending: true,
      },
      "node-proper-level5-pending-microtask-refused",
    ],
  ];
  const refusedRows = cases.map(([state, expectedCode]) => {
    const result = classify(state);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${state.id} failed: ${JSON.stringify(result)}`);
    }
    return {
      id: state.id,
      expectedCode,
      actualCode: result.refusal.code,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-active-work-refusal-matrix-summary",
    proof: "114",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted: idle,
    refusedRows,
    assertions: {
      idleOnlyAccepted: true,
      activeAndPendingWorkRefused: refusedRows.length === 4,
      targetNotStartedForActiveWork: refusedRows.every((row) => row.targetStarted === false),
      noMetadataOnlySuccess: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_114_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/114/checked-summary.json is stale; rerun with UPDATE_PROOF_114_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ refused: refusedRows.length }));
  console.log("proof 114 active work refusal matrix passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
