#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
type Gates = {
  nativeVerifier: boolean;
  provenance: boolean;
  classifier: boolean;
  resources: boolean;
  productClaims: boolean;
  shortcuts: boolean;
};
function materialize(gates: Gates): {
  accepted: boolean;
  code: string;
  targetStarted: boolean;
  response?: Record<string, unknown>;
} {
  if (!gates.nativeVerifier) {
    return {
      accepted: false,
      code: "node-proper-level5-materializer-native-verifier-required",
      targetStarted: false,
    };
  }
  if (!gates.provenance) {
    return {
      accepted: false,
      code: "node-proper-level5-materializer-provenance-required",
      targetStarted: false,
    };
  }
  if (!gates.classifier) {
    return {
      accepted: false,
      code: "node-proper-level5-materializer-thread-classifier-required",
      targetStarted: false,
    };
  }
  if (!gates.resources) {
    return {
      accepted: false,
      code: "node-proper-level5-materializer-resource-gate-required",
      targetStarted: false,
    };
  }
  if (!gates.productClaims) {
    return {
      accepted: false,
      code: "node-proper-level5-materializer-product-claim-refused",
      targetStarted: false,
    };
  }
  if (!gates.shortcuts) {
    return {
      accepted: false,
      code: "node-proper-level5-materializer-shortcut-refused",
      targetStarted: false,
    };
  }
  return {
    accepted: true,
    code: "accepted",
    targetStarted: true,
    response: { count: 3, graphTotal: 3, targetNative: true },
  };
}
function main(): void {
  const all: Gates = {
    nativeVerifier: true,
    provenance: true,
    classifier: true,
    resources: true,
    productClaims: true,
    shortcuts: true,
  };
  const accepted = materialize(all);
  if (!accepted.accepted || !accepted.targetStarted || accepted.response?.count !== 3) {
    throw new Error(`accepted failed: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, Partial<Gates>, string]> = [
    [
      "native-verifier",
      { nativeVerifier: false },
      "node-proper-level5-materializer-native-verifier-required",
    ],
    ["provenance", { provenance: false }, "node-proper-level5-materializer-provenance-required"],
    [
      "classifier",
      { classifier: false },
      "node-proper-level5-materializer-thread-classifier-required",
    ],
    ["resources", { resources: false }, "node-proper-level5-materializer-resource-gate-required"],
    [
      "product-claims",
      { productClaims: false },
      "node-proper-level5-materializer-product-claim-refused",
    ],
    ["shortcuts", { shortcuts: false }, "node-proper-level5-materializer-shortcut-refused"],
  ];
  const refusedRows = cases.map(([id, override, expectedCode]) => {
    const result = materialize({ ...all, ...override });
    if (result.accepted || result.targetStarted || result.code !== expectedCode) {
      throw new Error(`${id} failed: ${JSON.stringify(result)}`);
    }
    return { id, expectedCode, actualCode: result.code, targetStarted: result.targetStarted };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-target-materializer-boundary-summary",
    proof: "064",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      targetStartsOnlyAfterAllGatesPass: true,
      eachMissingGateRefusesBeforeTargetStart: true,
      acceptedTargetReturnedNextState: accepted.response?.count === 3,
      noProductSupportClaimed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_064_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/064/checked-summary.json is stale; rerun with UPDATE_PROOF_064_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: accepted.response, refused: refusedRows.length }));
  console.log("proof 064 target materializer boundary hardening passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
