#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type Resource = { id: string; kind: string; safe: boolean; sourceHandleCopied: boolean };
type Result = {
  accepted: boolean;
  targetStarted: boolean;
  descriptors?: Resource[];
  refusal?: { code: string; id: string };
};
const supported = new Set([
  "tcp-listener-v1",
  "timer-v1",
  "stdio-v1",
  "readonly-file-v1",
  "pipe-endpoint-v1",
]);
function verify(resources: Resource[]): Result {
  for (const resource of resources) {
    if (!supported.has(resource.kind)) {
      return {
        accepted: false,
        targetStarted: false,
        refusal: { code: "node-proper-level5-resource-kind-unsupported", id: resource.id },
      };
    }
    if (!resource.safe) {
      return {
        accepted: false,
        targetStarted: false,
        refusal: { code: "node-proper-level5-resource-state-unsafe", id: resource.id },
      };
    }
    if (resource.sourceHandleCopied) {
      return {
        accepted: false,
        targetStarted: false,
        refusal: {
          code: "node-proper-level5-resource-source-handle-copy-refused",
          id: resource.id,
        },
      };
    }
  }
  return { accepted: true, targetStarted: false, descriptors: resources };
}
function main(): void {
  const resources: Resource[] = [
    { id: "listener", kind: "tcp-listener-v1", safe: true, sourceHandleCopied: false },
    { id: "timer", kind: "timer-v1", safe: true, sourceHandleCopied: false },
    { id: "stdio", kind: "stdio-v1", safe: true, sourceHandleCopied: false },
    { id: "config", kind: "readonly-file-v1", safe: true, sourceHandleCopied: false },
    { id: "pipe", kind: "pipe-endpoint-v1", safe: true, sourceHandleCopied: false },
  ];
  const accepted = verify(resources);
  if (!accepted.accepted || accepted.descriptors?.length !== 5) {
    throw new Error(`resources refused: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, Resource[], string]> = [
    [
      "unknown-kind",
      [{ id: "gpu", kind: "gpu-device-v1", safe: true, sourceHandleCopied: false }],
      "node-proper-level5-resource-kind-unsupported",
    ],
    [
      "unsafe-state",
      [{ id: "pipe", kind: "pipe-endpoint-v1", safe: false, sourceHandleCopied: false }],
      "node-proper-level5-resource-state-unsafe",
    ],
    [
      "source-handle-copy",
      [{ id: "file", kind: "readonly-file-v1", safe: true, sourceHandleCopied: true }],
      "node-proper-level5-resource-source-handle-copy-refused",
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
      resourceId: result.refusal.id,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-resource-descriptor-expansion-summary",
    proof: "113",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    acceptedResourceKinds: resources.map((resource) => resource.kind),
    refusedRows,
    assertions: {
      expandedResourceDescriptorSet: resources.length === 5,
      unsupportedResourcesRefuseBeforeTargetStart: refusedRows.every(
        (row) => row.targetStarted === false,
      ),
      sourceHandlesNotCopied: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_113_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/113/checked-summary.json is stale; rerun with UPDATE_PROOF_113_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ resources: resources.length, refused: refusedRows.length }));
  console.log("proof 113 resource descriptor expansion passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
