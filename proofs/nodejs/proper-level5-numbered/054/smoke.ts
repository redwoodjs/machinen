#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

const shortcutCodes: Record<string, string> = {
  appExportImportUsed: "node-proper-level5-shortcut-app-export-import-refused",
  checkpointHookUsed: "node-proper-level5-shortcut-checkpoint-hook-refused",
  selectedStateDescriptorUsed: "node-proper-level5-shortcut-selected-state-descriptor-refused",
  sourceIsaEmulationUsed: "node-proper-level5-shortcut-source-isa-emulation-refused",
  rawSourceRegistersCopiedToTarget: "node-proper-level5-shortcut-raw-register-copy-refused",
  rawSourcePcCopiedToTarget: "node-proper-level5-shortcut-raw-pc-copy-refused",
  rawSourceStackCopiedToTarget: "node-proper-level5-shortcut-raw-stack-copy-refused",
  sourceKernelFdReusedOnTarget: "node-proper-level5-shortcut-source-fd-reuse-refused",
  sidecarReplayUsed: "node-proper-level5-shortcut-sidecar-replay-refused",
  runtimeProfileRouteUsed: "node-proper-level5-shortcut-runtime-profile-refused",
  responseStringReplayUsed: "node-proper-level5-shortcut-response-string-replay-refused",
  metadataOnlySuccess: "node-proper-level5-shortcut-metadata-only-success-refused",
};

function controlBundle(): Record<string, unknown> {
  return {
    kind: "machinen.node-proper-level5-negative-shortcut-gauntlet-bundle",
    proof: "054",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    sourceArchitecture: "arm64",
    targetArchitecture: "amd64",
    translatedContinuationUsed: true,
    heapGraphIr: { count: 2, graphTotal: 2 },
    continuationDescriptor: "node-libuv-event-loop-wait-v1",
    resourceDescriptors: ["tcp-listener-v1"],
    ...Object.fromEntries(Object.keys(shortcutCodes).map((key) => [key, false])),
  };
}

function verify(bundle: Record<string, unknown>): {
  accepted: boolean;
  code: string;
  targetStarted: boolean;
} {
  for (const [field, code] of Object.entries(shortcutCodes)) {
    if (bundle[field] === true) {
      return { accepted: false, code, targetStarted: false };
    }
  }
  if (bundle.translatedContinuationUsed !== true) {
    return {
      accepted: false,
      code: "node-proper-level5-shortcut-translated-continuation-required",
      targetStarted: false,
    };
  }
  return { accepted: true, code: "accepted", targetStarted: false };
}

function materialize(bundle: Record<string, unknown>): Record<string, unknown> {
  const heap = bundle.heapGraphIr as Record<string, unknown>;
  return {
    count: Number(heap.count) + 1,
    graphTotal: Number(heap.graphTotal) + 1,
    targetNative: true,
  };
}

function main(): void {
  const accepted = verify(controlBundle());
  if (!accepted.accepted || accepted.targetStarted) {
    throw new Error(`control refused: ${JSON.stringify(accepted)}`);
  }
  const target = materialize(controlBundle());
  if (target.count !== 3 || target.graphTotal !== 3) {
    throw new Error(`control target failed: ${JSON.stringify(target)}`);
  }
  const refusedRows = Object.entries(shortcutCodes).map(([field, expectedCode]) => {
    const result = verify({ ...controlBundle(), [field]: true });
    if (result.accepted || result.code !== expectedCode || result.targetStarted) {
      throw new Error(`${field} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    return {
      id: field,
      expectedCode,
      actualCode: result.code,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-negative-shortcut-gauntlet-summary",
    proof: "054",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    acceptedControl: { ...accepted, target },
    refusedRows,
    assertions: {
      everyForbiddenShortcutRefused: refusedRows.length === Object.keys(shortcutCodes).length,
      refusedVariantsNeverStartTarget: refusedRows.every((row) => row.targetStarted === false),
      controlUsesTranslatedContinuation: true,
      controlTargetReturnedNextState: target.count === 3 && target.graphTotal === 3,
      noProductSupportClaimed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_054_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/054/checked-summary.json is stale; rerun with UPDATE_PROOF_054_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ control: target, refused: refusedRows.length }));
  console.log("node proper Level 5 negative shortcut gauntlet proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
