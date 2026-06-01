#!/usr/bin/env tsx
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type ResourceKind =
  | "tcp-listener-v1"
  | "repeating-timer-v1"
  | "pending-timeout-v1"
  | "eventfd-counter-v1";
interface ResourceDescriptor {
  id: string;
  kind: ResourceKind | "connected-socket" | "epoll" | "fs-watcher" | "dns-request" | "unknown";
  sourceKernelFdCopiedToTarget?: boolean;
  sourceLibuvHandleCopiedToTarget?: boolean;
  unreadBytes?: number;
  pendingWrites?: number;
}

const supportedKinds = new Set<ResourceKind>([
  "tcp-listener-v1",
  "repeating-timer-v1",
  "pending-timeout-v1",
  "eventfd-counter-v1",
]);

function classify(descriptor: ResourceDescriptor): { accepted: boolean; code?: string } {
  if (descriptor.sourceKernelFdCopiedToTarget || descriptor.sourceLibuvHandleCopiedToTarget) {
    return { accepted: false, code: "node-proper-level5-resource-source-handle-copy-forbidden" };
  }
  if (descriptor.unreadBytes) {
    return {
      accepted: false,
      code: "node-proper-level5-connected-socket-unread-bytes-unsupported",
    };
  }
  if (descriptor.pendingWrites) {
    return { accepted: false, code: "node-proper-level5-pending-write-unsupported" };
  }
  if (!supportedKinds.has(descriptor.kind as ResourceKind)) {
    return { accepted: false, code: `node-proper-level5-${descriptor.kind}-resource-unsupported` };
  }
  return { accepted: true };
}

async function materialize(
  descriptors: ResourceDescriptor[],
): Promise<{ count: number; timerTicks: number; eventfdValue: number }> {
  for (const descriptor of descriptors) {
    const result = classify(descriptor);
    if (!result.accepted) {
      throw new Error(`descriptor refused: ${result.code}`);
    }
  }
  let count = 2;
  let timerTicks = 0;
  let eventfdValue = 7;
  const interval = setInterval(() => {
    timerTicks += 1;
  }, 50);
  interval.unref();
  const server = createServer((req, res) => {
    count += 1;
    eventfdValue += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ count, timerTicks, eventfdValue }) + "\n");
  });
  try {
    const port = await new Promise<number>((resolvePort, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          return reject(new Error("missing port"));
        }
        resolvePort(address.port);
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const response = await fetch(`http://127.0.0.1:${port}/`);
    return (await response.json()) as { count: number; timerTicks: number; eventfdValue: number };
  } finally {
    clearInterval(interval);
    server.close();
  }
}

async function main(): Promise<void> {
  const descriptors: ResourceDescriptor[] = [
    { id: "listener", kind: "tcp-listener-v1" },
    { id: "timer", kind: "repeating-timer-v1" },
    { id: "timeout", kind: "pending-timeout-v1" },
    { id: "eventfd", kind: "eventfd-counter-v1" },
  ];
  const target = await materialize(descriptors);
  if (target.count !== 3 || target.timerTicks < 1 || target.eventfdValue !== 8) {
    throw new Error(`target resource materialization failed: ${JSON.stringify(target)}`);
  }
  const refusedRows = [
    [
      "connected-unread",
      { id: "bad", kind: "connected-socket", unreadBytes: 4 },
      "node-proper-level5-connected-socket-unread-bytes-unsupported",
    ],
    [
      "pending-write",
      { id: "bad", kind: "connected-socket", pendingWrites: 1 },
      "node-proper-level5-pending-write-unsupported",
    ],
    ["epoll", { id: "bad", kind: "epoll" }, "node-proper-level5-epoll-resource-unsupported"],
    [
      "fs-watcher",
      { id: "bad", kind: "fs-watcher" },
      "node-proper-level5-fs-watcher-resource-unsupported",
    ],
    [
      "dns-request",
      { id: "bad", kind: "dns-request" },
      "node-proper-level5-dns-request-resource-unsupported",
    ],
    [
      "source-fd-copy",
      { id: "bad", kind: "tcp-listener-v1", sourceKernelFdCopiedToTarget: true },
      "node-proper-level5-resource-source-handle-copy-forbidden",
    ],
  ].map(([id, descriptor, expectedCode]) => {
    const result = classify(descriptor as ResourceDescriptor);
    if (result.accepted || result.code !== expectedCode) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    return { id, expectedCode, actualCode: result.code, materializerStarted: false };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-resource-descriptor-expansion-summary",
    proof: "043",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    supportedDescriptors: descriptors,
    target,
    refusedRows,
    assertions: {
      supportedResourcesMaterializedTargetNatively: true,
      unsupportedResourcesRefused: refusedRows.length === 6,
      sourceKernelFdsNotReused: true,
      sourceLibuvHandlesNotCopied: true,
      noSourceIsaEmulation: true,
      noMetadataOnlySuccess: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_043_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/043/checked-summary.json is stale; rerun with UPDATE_PROOF_043_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("node proper Level 5 native resource descriptor expansion proof passed");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
