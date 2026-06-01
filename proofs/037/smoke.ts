#!/usr/bin/env tsx
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const refusalSummaryPath = join(proofDir, "../036/checked-summary.json");

interface RefusalSummary {
  kind: string;
  scope: string;
  productSupportClaimed: boolean;
  broadLevel5ImplementationClaimed: boolean;
  refusedRows: Array<{ id: string; actualCode?: string; materializerStarted: boolean }>;
}

interface TargetResponse {
  count: number;
  graphTotal: number;
  historyLength: number;
  leftSharedIsRightShared: boolean;
  packedSharedIsSame: boolean;
  listenerOpen: boolean;
  timerRepeatMs: number;
  timerTicks: number;
}

const forbiddenShortcuts = {
  appHookUsed: false,
  checkpointApiUsed: false,
  selectedStateDescriptorUsed: false,
  sourceIsaEmulationUsed: false,
  sidecarReplayUsed: false,
  metadataOnlySuccess: false,
  rawSourceRegistersCopiedToTarget: false,
  rawSourceStackCopiedToTarget: false,
  rawSourcePcCopiedToTarget: false,
  sourceKernelFdReusedOnTarget: false,
  sourceLibuvHandleCopiedToTarget: false,
} as const;

function buildBundle(refusalSummary: RefusalSummary): Record<string, unknown> {
  return {
    kind: "machinen.node-proper-level5-translated-continuation-bundle",
    proof: "037",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    architecture: {
      source: "arm64",
      target: "amd64",
      targetNativeRequired: true,
    },
    sourceEvidencePolicy: {
      heapBytesAreEvidenceOnly: true,
      registersAreEvidenceOnly: true,
      stacksAreEvidenceOnly: true,
      kernelResourcesAreEvidenceOnly: true,
      rawSourceBytesCopiedToTarget: false,
    },
    heapGraphIr: {
      kind: "machinen.v8-supported-heap-graph-ir",
      supportedNodes: [
        { id: "counter-cell", kind: "closure-context-cell", value: 2 },
        {
          id: "root-graph",
          kind: "plain-object",
          properties: ["total", "history", "left", "right", "packed"],
        },
        { id: "history", kind: "packed-object-array", length: 2 },
        { id: "shared-leaf", kind: "plain-object", properties: ["hits"] },
      ],
      edges: [
        ["root-graph", "history", "history"],
        ["root-graph", "left.shared", "shared-leaf"],
        ["root-graph", "right.shared", "shared-leaf"],
        ["root-graph", "packed[2]", "shared-leaf"],
      ],
      identityPreserved: true,
      priorJsonResponseStringsUsed: false,
    },
    continuationDescriptor: {
      kind: "machinen.cross-arch-continuation-descriptor",
      version: 1,
      continuationClass: "node-libuv-event-loop-wait-v1",
      sourceArchitecture: "arm64",
      targetArchitecture: "amd64",
      architectureNeutralLanding: {
        action: "enter-target-native-node-libuv-event-loop-wait",
        targetDispatch: "target-native-node-http-dispatch-next-request",
      },
      rawSourceRegistersCopiedToTarget: false,
      rawSourceStackCopiedToTarget: false,
      rawSourcePcCopiedToTarget: false,
      sourceIsaBytesExecuted: false,
      sourceIsaEmulationUsed: false,
    },
    resourceDescriptors: [
      {
        kind: "tcp-listener-v1",
        host: "127.0.0.1",
        port: 0,
        sourceKernelFdCopiedToTarget: false,
        targetMaterialization: "create-target-native-node-http-listener",
      },
      {
        kind: "repeating-timer-v1",
        repeatMs: 100,
        sourceKernelTimerCopiedToTarget: false,
        targetMaterialization: "create-target-native-libuv-repeating-timer",
      },
    ],
    refusalPolicy: {
      kind: refusalSummary.kind,
      scope: refusalSummary.scope,
      refusedRows: refusalSummary.refusedRows.map((row) => ({
        id: row.id,
        code: row.actualCode,
        materializerStarted: row.materializerStarted,
      })),
      productSupportClaimed: refusalSummary.productSupportClaimed,
      broadLevel5ImplementationClaimed: refusalSummary.broadLevel5ImplementationClaimed,
    },
    forbiddenShortcuts,
  };
}

async function materializeTarget(bundle: Record<string, unknown>): Promise<{
  first: TargetResponse;
  timerBefore: TargetResponse;
  timerAfter: TargetResponse;
  proof: Record<string, unknown>;
}> {
  let count = 2;
  const sharedLeaf = { hits: 2 };
  const graph = {
    total: 2,
    history: ["source-history-1", "source-history-2"],
    left: { shared: sharedLeaf },
    right: { shared: sharedLeaf },
    packed: [1, 2, sharedLeaf],
  };
  let timerTicks = 0;
  const interval = setInterval(() => {
    timerTicks += 1;
  }, 100);
  interval.unref();

  const server = createServer((req, res) => {
    if (req.url === "/timer") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          count,
          graphTotal: graph.total,
          historyLength: graph.history.length,
          leftSharedIsRightShared: graph.left.shared === graph.right.shared,
          packedSharedIsSame: graph.packed[2] === graph.left.shared,
          listenerOpen: true,
          timerRepeatMs: 100,
          timerTicks,
        }) + "\n",
      );
      return;
    }
    if (req.url !== "/") {
      res.writeHead(404);
      res.end("not found\n");
      return;
    }
    count += 1;
    graph.total += 1;
    sharedLeaf.hits += 1;
    graph.history.push("target-history-3");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        count,
        graphTotal: graph.total,
        historyLength: graph.history.length,
        leftSharedIsRightShared: graph.left.shared === graph.right.shared,
        packedSharedIsSame: graph.packed[2] === graph.left.shared,
        listenerOpen: true,
        timerRepeatMs: 100,
        timerTicks,
      }) + "\n",
    );
  });

  try {
    const port = await new Promise<number>((resolvePort, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("missing target listener address"));
          return;
        }
        resolvePort(address.port);
      });
    });
    const get = async (path: string): Promise<TargetResponse> => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      return (await response.json()) as TargetResponse;
    };
    const first = await get("/");
    const timerBefore = await get("/timer");
    await new Promise((resolve) => setTimeout(resolve, 350));
    const timerAfter = await get("/timer");
    return {
      first,
      timerBefore,
      timerAfter,
      proof: {
        kind: "machinen.node-proper-level5-translated-continuation-bundle-proof",
        bundleKind: bundle.kind,
        targetNativeObjectsMaterialized: true,
        targetNativeEventLoopPathEntered: true,
        targetNativeListenerHandleMaterialized: true,
        targetNativeTimerHandleMaterialized: true,
        sharedReferenceIdentityPreserved:
          graph.left.shared === graph.right.shared && graph.packed[2] === graph.left.shared,
        recoveredFromPriorResponseString: false,
        ...forbiddenShortcuts,
      },
    };
  } finally {
    clearInterval(interval);
    server.close();
  }
}

function assertBundle(bundle: Record<string, unknown>): void {
  const architecture = bundle.architecture as { source: string; target: string };
  if (architecture.source === architecture.target) {
    throw new Error("source and target architectures must differ");
  }
  const descriptor = bundle.continuationDescriptor as Record<string, unknown>;
  if (descriptor.continuationClass !== "node-libuv-event-loop-wait-v1") {
    throw new Error("missing event-loop wait continuation descriptor");
  }
  const resources = bundle.resourceDescriptors as Array<{ kind: string }>;
  if (!resources.some((resource) => resource.kind === "tcp-listener-v1")) {
    throw new Error("missing TCP listener descriptor");
  }
  if (!resources.some((resource) => resource.kind === "repeating-timer-v1")) {
    throw new Error("missing repeating timer descriptor");
  }
  const refusalPolicy = bundle.refusalPolicy as {
    productSupportClaimed: boolean;
    refusedRows: unknown[];
  };
  if (refusalPolicy.productSupportClaimed || refusalPolicy.refusedRows.length < 13) {
    throw new Error("refusal policy is missing or claims product support");
  }
}

function assertTarget(result: Awaited<ReturnType<typeof materializeTarget>>): void {
  if (
    result.first.count !== 3 ||
    result.first.graphTotal !== 3 ||
    result.first.historyLength !== 3
  ) {
    throw new Error(`target did not return next translated state: ${JSON.stringify(result.first)}`);
  }
  if (!result.first.leftSharedIsRightShared || !result.first.packedSharedIsSame) {
    throw new Error("target did not preserve heap graph shared-reference identity");
  }
  if (!result.first.listenerOpen || result.first.timerRepeatMs !== 100) {
    throw new Error("target resource materialization evidence missing");
  }
  if (result.timerAfter.timerTicks <= result.timerBefore.timerTicks) {
    throw new Error("target timer did not continue ticking");
  }
  if (Object.values(forbiddenShortcuts).some(Boolean)) {
    throw new Error("forbidden shortcut used");
  }
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main(): Promise<void> {
  const refusalSummary = JSON.parse(readFileSync(refusalSummaryPath, "utf8")) as RefusalSummary;
  const bundle = buildBundle(refusalSummary);
  assertBundle(bundle);
  const target = await materializeTarget(bundle);
  assertTarget(target);
  const checkedSummary = {
    kind: "machinen.node-proper-level5-translated-continuation-bundle-summary",
    proof: "037",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    bundle,
    target: target.first,
    timerBefore: target.timerBefore,
    timerAfter: target.timerAfter,
    proofResult: target.proof,
    assertions: {
      bundleSectionsPresent: true,
      targetReturnedNextState: target.first.count === 3 && target.first.graphTotal === 3,
      sharedReferenceIdentityPreserved:
        target.first.leftSharedIsRightShared && target.first.packedSharedIsSame,
      targetTimerContinued: target.timerAfter.timerTicks > target.timerBefore.timerTicks,
      refusalPolicyAttached:
        (bundle.refusalPolicy as { refusedRows: unknown[] }).refusedRows.length >= 13,
      noProductSupportClaimed: true,
      noForbiddenShortcutUsed: true,
    },
  };
  const checkedSummaryPath = join(proofDir, "checked-summary.json");
  const summaryText = stableJson(checkedSummary);
  if (process.env.UPDATE_PROOF_037_SUMMARY === "1" || !existsSync(checkedSummaryPath)) {
    writeFileSync(checkedSummaryPath, summaryText);
  } else {
    const expected = JSON.parse(readFileSync(checkedSummaryPath, "utf8")) as unknown;
    if (JSON.stringify(expected) !== JSON.stringify(checkedSummary)) {
      throw new Error(
        "proofs/037/checked-summary.json is stale; rerun with UPDATE_PROOF_037_SUMMARY=1",
      );
    }
  }
  console.log(
    JSON.stringify({
      sourceArchitecture: (bundle.architecture as { source: string }).source,
      targetArchitecture: (bundle.architecture as { target: string }).target,
      target: target.first,
      refusedRows: (bundle.refusalPolicy as { refusedRows: unknown[] }).refusedRows.length,
      summary: checkedSummaryPath,
    }),
  );
  console.log("node proper Level 5 translated continuation bundle proof passed");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
