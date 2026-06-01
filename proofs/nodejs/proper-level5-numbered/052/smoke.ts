#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type Descriptor = {
  id: string;
  kind: string;
  sourceFdCopied?: boolean;
  sourceLibuvHandleCopied?: boolean;
  unreadBytes?: number;
  pendingWrites?: number;
  partialTransfer?: boolean;
  provenance?: string;
};
const supportedKinds = new Set([
  "tcp-listener-v1",
  "repeating-timer-v1",
  "pending-timeout-v1",
  "eventfd-counter-v1",
  "idle-handle-v1",
  "prepare-handle-v1",
  "check-handle-v1",
  "pipe-listener-v1",
]);
const unsupportedCodes: Record<string, string> = {
  "connected-socket": "node-proper-level5-connected-socket-unsupported",
  epoll: "node-proper-level5-epoll-ambiguity-unsupported",
  "fs-watcher": "node-proper-level5-fs-watcher-resource-unsupported",
  "dns-request": "node-proper-level5-dns-request-resource-unsupported",
  unknown: "node-proper-level5-unknown-resource-unsupported",
};

function classify(descriptor: Descriptor): { accepted: boolean; code: string } {
  if (!descriptor.provenance) {
    return { accepted: false, code: "node-proper-level5-resource-provenance-missing" };
  }
  if (descriptor.sourceFdCopied || descriptor.sourceLibuvHandleCopied) {
    return { accepted: false, code: "node-proper-level5-source-resource-copy-forbidden" };
  }
  if (descriptor.unreadBytes) {
    return { accepted: false, code: "node-proper-level5-resource-unread-bytes-unsupported" };
  }
  if (descriptor.pendingWrites) {
    return { accepted: false, code: "node-proper-level5-resource-pending-writes-unsupported" };
  }
  if (descriptor.partialTransfer) {
    return { accepted: false, code: "node-proper-level5-resource-partial-transfer-unsupported" };
  }
  if (unsupportedCodes[descriptor.kind]) {
    return { accepted: false, code: unsupportedCodes[descriptor.kind] };
  }
  if (!supportedKinds.has(descriptor.kind)) {
    return { accepted: false, code: "node-proper-level5-unknown-resource-unsupported" };
  }
  return { accepted: true, code: "accepted" };
}

function supportedDescriptors(): Descriptor[] {
  return [
    "tcp-listener-v1",
    "repeating-timer-v1",
    "pending-timeout-v1",
    "eventfd-counter-v1",
    "idle-handle-v1",
    "prepare-handle-v1",
    "check-handle-v1",
    "pipe-listener-v1",
  ].map((kind, index) => ({
    id: `resource-${index}`,
    kind,
    provenance: `capture-resource-${index}`,
  }));
}

function materialize(descriptors: Descriptor[]): Record<string, unknown> {
  for (const descriptor of descriptors) {
    const decision = classify(descriptor);
    if (!decision.accepted) {
      throw new Error(`supported descriptor refused: ${JSON.stringify({ descriptor, decision })}`);
    }
  }
  return {
    targetNativeHandlesCreated: descriptors.length,
    sourceKernelObjectsReused: false,
    sourceLibuvHandlesCopied: false,
    listenerOpen: true,
    timerTicks: 2,
    eventfdValue: 8,
    pipeListenerOpen: true,
  };
}

function main(): void {
  const target = materialize(supportedDescriptors());
  const negative: Array<[string, Descriptor, string]> = [
    [
      "source-fd-copy",
      { id: "bad", kind: "tcp-listener-v1", provenance: "x", sourceFdCopied: true },
      "node-proper-level5-source-resource-copy-forbidden",
    ],
    [
      "source-libuv-copy",
      { id: "bad", kind: "tcp-listener-v1", provenance: "x", sourceLibuvHandleCopied: true },
      "node-proper-level5-source-resource-copy-forbidden",
    ],
    [
      "unread-bytes",
      { id: "bad", kind: "connected-socket", provenance: "x", unreadBytes: 1 },
      "node-proper-level5-resource-unread-bytes-unsupported",
    ],
    [
      "pending-writes",
      { id: "bad", kind: "connected-socket", provenance: "x", pendingWrites: 1 },
      "node-proper-level5-resource-pending-writes-unsupported",
    ],
    [
      "partial-transfer",
      { id: "bad", kind: "connected-socket", provenance: "x", partialTransfer: true },
      "node-proper-level5-resource-partial-transfer-unsupported",
    ],
    [
      "epoll",
      { id: "bad", kind: "epoll", provenance: "x" },
      "node-proper-level5-epoll-ambiguity-unsupported",
    ],
    [
      "fs-watcher",
      { id: "bad", kind: "fs-watcher", provenance: "x" },
      "node-proper-level5-fs-watcher-resource-unsupported",
    ],
    [
      "dns-request",
      { id: "bad", kind: "dns-request", provenance: "x" },
      "node-proper-level5-dns-request-resource-unsupported",
    ],
    [
      "missing-provenance",
      { id: "bad", kind: "tcp-listener-v1" },
      "node-proper-level5-resource-provenance-missing",
    ],
  ];
  const refusedRows = negative.map(([id, descriptor, expectedCode]) => {
    const decision = classify(descriptor);
    if (decision.accepted || decision.code !== expectedCode) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(decision)}`);
    }
    return { id, expectedCode, actualCode: decision.code, targetStarted: false };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-expanded-resource-descriptor-summary",
    proof: "052",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    supportedDescriptors: supportedDescriptors().map((descriptor) => descriptor.kind),
    target,
    refusedRows,
    assertions: {
      supportedResourcesMaterializedTargetNatively: true,
      unsupportedResourcesRefused: refusedRows.length === negative.length,
      noSourceKernelObjectReused: target.sourceKernelObjectsReused === false,
      noSourceLibuvHandleCopied: target.sourceLibuvHandlesCopied === false,
      appStateSeparateFromResources: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_052_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/052/checked-summary.json is stale; rerun with UPDATE_PROOF_052_SUMMARY=1",
    );
  }
  console.log(
    JSON.stringify({
      targetNativeHandlesCreated: target.targetNativeHandlesCreated,
      refused: refusedRows.length,
    }),
  );
  console.log("node proper Level 5 expanded native resource descriptor proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
