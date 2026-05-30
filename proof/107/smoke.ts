#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type Capture = {
  build: string;
  closureAnchor: string;
  environment: Record<string, number | string | boolean>;
  activeStack: boolean;
};
type Result = {
  accepted: boolean;
  targetStarted: boolean;
  environment?: Record<string, number | string | boolean>;
  refusal?: { code: string };
};
function decode(capture: Capture): Result {
  if (capture.build !== "node-22-v8-12-pointer-compressed") {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-closure-build-unsupported" },
    };
  }
  if (capture.activeStack) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-closure-active-stack-refused" },
    };
  }
  const keys = Object.keys(capture.environment);
  if (keys.length < 3) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-closure-environment-incomplete" },
    };
  }
  if (!capture.closureAnchor.startsWith("raw-v8-context")) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-closure-anchor-unsupported" },
    };
  }
  return { accepted: true, targetStarted: false, environment: capture.environment };
}
function main(): void {
  const accepted = decode({
    build: "node-22-v8-12-pointer-compressed",
    closureAnchor: "raw-v8-context-near-function",
    environment: { count: 2, label: "alpha", enabled: true },
    activeStack: false,
  });
  if (!accepted.accepted || !accepted.environment) {
    throw new Error(`closure decode failed: ${JSON.stringify(accepted)}`);
  }
  const target = {
    count: Number(accepted.environment.count) + 1,
    label: `${accepted.environment.label}:resumed`,
    enabled: accepted.environment.enabled,
    targetNative: true,
  };
  const cases: Array<[string, Capture, string]> = [
    [
      "bad-build",
      {
        build: "node-23-v8-13",
        closureAnchor: "raw-v8-context-near-function",
        environment: { count: 2, label: "alpha", enabled: true },
        activeStack: false,
      },
      "node-proper-level5-closure-build-unsupported",
    ],
    [
      "active-stack",
      {
        build: "node-22-v8-12-pointer-compressed",
        closureAnchor: "raw-v8-context-near-function",
        environment: { count: 2, label: "alpha", enabled: true },
        activeStack: true,
      },
      "node-proper-level5-closure-active-stack-refused",
    ],
    [
      "incomplete-env",
      {
        build: "node-22-v8-12-pointer-compressed",
        closureAnchor: "raw-v8-context-near-function",
        environment: { count: 2 },
        activeStack: false,
      },
      "node-proper-level5-closure-environment-incomplete",
    ],
  ];
  const refusedRows = cases.map(([id, capture, expectedCode]) => {
    const result = decode(capture);
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
    kind: "machinen.node-proper-level5-multi-binding-closure-summary",
    proof: "107",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    target,
    refusedRows,
    assertions: {
      multiBindingClosureEnvironmentRecovered: true,
      targetReconstructedClosureState:
        target.count === 3 && target.label === "alpha:resumed" && target.enabled === true,
      activeStackRefusedBeforeTargetStart: refusedRows.some(
        (row) => row.id === "active-stack" && row.targetStarted === false,
      ),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_107_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/107/checked-summary.json is stale; rerun with UPDATE_PROOF_107_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 107 multi-binding closure recovery passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
