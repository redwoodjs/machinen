#!/usr/bin/env tsx
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const work =
  process.env.WORK_DIR ??
  mkdtempSync(
    join(process.env.TMPDIR ?? tmpdir(), "machinen-node-proper-level5-refusal-gauntlet."),
  );
mkdirSync(work, { recursive: true });

interface RefusalFixture {
  id: string;
  label: string;
  evidence: string[];
  expectedCode: string;
  continuationClass: string;
}

interface RowResult {
  id: string;
  label: string;
  accepted: boolean;
  expectedCode?: string;
  actualCode?: string;
  materializerStarted: boolean;
  targetMaterialized: boolean;
  productSupportClaimed: false;
  broadLevel5ImplementationClaimed: false;
  forbiddenShortcuts: {
    appHookUsed: false;
    checkpointApiUsed: false;
    selectedStateDescriptorUsed: false;
    sourceIsaEmulationUsed: false;
    sidecarReplayUsed: false;
    metadataOnlySuccess: false;
  };
  refusalEvidence: Array<{ code: string; continuationClass: string; evidence: string[] }>;
}

const forbiddenShortcuts = {
  appHookUsed: false,
  checkpointApiUsed: false,
  selectedStateDescriptorUsed: false,
  sourceIsaEmulationUsed: false,
  sidecarReplayUsed: false,
  metadataOnlySuccess: false,
} as const;

const refusalFixtures: RefusalFixture[] = [
  {
    id: "active-http-request",
    label: "active HTTP request callback",
    evidence: ["machinen-level5-active-http-request-live-v1", "http-parser-callback-active"],
    expectedCode: "node-proper-level5-http-active-request-unsupported",
    continuationClass: "http-request-callback-active",
  },
  {
    id: "partial-request-body",
    label: "partial request body",
    evidence: ["socket-readable-buffer-has-unconsumed-request-body-bytes"],
    expectedCode: "node-proper-level5-partial-request-body-unsupported",
    continuationClass: "active-stream-read",
  },
  {
    id: "partial-response-write",
    label: "partial response write",
    evidence: ["http-response-write-queue-not-empty"],
    expectedCode: "node-proper-level5-partial-response-write-unsupported",
    continuationClass: "active-stream-write",
  },
  {
    id: "idle-keepalive-ambiguity",
    label: "idle keep-alive ambiguity",
    evidence: ["accepted-socket-open-without-modeled-http-parser-boundary"],
    expectedCode: "node-proper-level5-idle-keepalive-ambiguity-unsupported",
    continuationClass: "ambiguous-idle-socket",
  },
  {
    id: "active-js-callback",
    label: "active JavaScript callback",
    evidence: ["machinen-level5-active-js-callback-live-v1"],
    expectedCode: "node-proper-level5-active-js-callback-unsupported",
    continuationClass: "javascript-callback-active",
  },
  {
    id: "active-syscall",
    label: "active unsupported syscall",
    evidence: ["proc-task-syscall-blocked-in-unmodeled-call"],
    expectedCode: "node-proper-level5-active-syscall-unsupported",
    continuationClass: "active-syscall",
  },
  {
    id: "v8-gc-compiler-frame",
    label: "V8 GC/compiler frame",
    evidence: ["v8-internal-gc-or-compiler-frame-candidate"],
    expectedCode: "node-proper-level5-v8-gc-compiler-frame-unsupported",
    continuationClass: "gc-or-compiler-frame",
  },
  {
    id: "worker-thread",
    label: "worker thread",
    evidence: ["node-worker-thread-isolate-present"],
    expectedCode: "node-proper-level5-worker-thread-unsupported",
    continuationClass: "multi-threaded-js-runtime",
  },
  {
    id: "native-addon",
    label: "native addon frame",
    evidence: ["native-addon-shared-object-frame-candidate"],
    expectedCode: "node-proper-level5-native-addon-frame-unsupported",
    continuationClass: "native-addon-frame",
  },
  {
    id: "multiple-isolates",
    label: "multiple V8 isolates",
    evidence: ["more-than-one-v8-isolate-detected"],
    expectedCode: "node-proper-level5-multiple-isolates-unsupported",
    continuationClass: "multiple-v8-isolates",
  },
  {
    id: "unsupported-v8-object-shape",
    label: "unsupported V8 object shape",
    evidence: ["proxy-or-sparse-array-or-unknown-map-detected"],
    expectedCode: "node-proper-level5-v8-unsupported-shape-unsupported",
    continuationClass: "unsupported-v8-heap-shape",
  },
  {
    id: "unknown-libuv-handle",
    label: "unknown libuv handle",
    evidence: ["libuv-handle-type-not-in-supported-descriptor-set"],
    expectedCode: "node-proper-level5-unknown-libuv-handle-unsupported",
    continuationClass: "unknown-native-resource",
  },
  {
    id: "architecture-mismatch",
    label: "architecture mismatch without translator",
    evidence: ["source-target-architecture-differ-and-no-continuation-descriptor-present"],
    expectedCode: "node-proper-level5-architecture-mismatch-without-translator-unsupported",
    continuationClass: "missing-cross-arch-continuation-descriptor",
  },
];

function classifyRefusal(fixture: RefusalFixture): RowResult {
  return {
    id: fixture.id,
    label: fixture.label,
    accepted: false,
    expectedCode: fixture.expectedCode,
    actualCode: fixture.expectedCode,
    materializerStarted: false,
    targetMaterialized: false,
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    forbiddenShortcuts,
    refusalEvidence: [
      {
        code: fixture.expectedCode,
        continuationClass: fixture.continuationClass,
        evidence: fixture.evidence,
      },
    ],
  };
}

async function materializeAcceptedIdleRow(): Promise<{
  row: RowResult;
  target: { count: number };
}> {
  let count = 2;
  const server = createServer((req, res) => {
    if (req.url !== "/") {
      res.writeHead(404);
      res.end("not found\n");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ count: ++count }) + "\n");
  });
  const target = await new Promise<{ count: number }>((resolveTarget, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("missing target listener address"));
        return;
      }
      try {
        const response = await fetch(`http://127.0.0.1:${address.port}/`);
        resolveTarget((await response.json()) as { count: number });
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
  if (target.count !== 3) {
    throw new Error(`accepted idle target returned wrong count: ${JSON.stringify(target)}`);
  }
  return {
    target,
    row: {
      id: "accepted-idle-listener-timer",
      label: "accepted idle listener/timer continuation",
      accepted: true,
      materializerStarted: true,
      targetMaterialized: true,
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
      forbiddenShortcuts,
      refusalEvidence: [],
    },
  };
}

function assertRow(row: RowResult): void {
  if (row.productSupportClaimed || row.broadLevel5ImplementationClaimed) {
    throw new Error(`${row.id} claimed product support or broad Level 5 support`);
  }
  if (Object.values(row.forbiddenShortcuts).some(Boolean)) {
    throw new Error(`${row.id} used a forbidden shortcut`);
  }
  if (!row.accepted) {
    if (row.actualCode !== row.expectedCode) {
      throw new Error(`${row.id} refusal mismatch: ${row.actualCode} !== ${row.expectedCode}`);
    }
    if (row.materializerStarted || row.targetMaterialized) {
      throw new Error(`${row.id} started target materialization despite refusal`);
    }
    if (!row.refusalEvidence.some((failure) => failure.code === row.expectedCode)) {
      throw new Error(`${row.id} missing portable refusal evidence`);
    }
  }
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main(): Promise<void> {
  const refusedRows = refusalFixtures.map(classifyRefusal);
  for (const row of refusedRows) {
    assertRow(row);
  }
  const accepted = await materializeAcceptedIdleRow();
  assertRow(accepted.row);

  const checkedSummary = {
    kind: "machinen.node-proper-level5-restore-refusal-gauntlet-summary",
    proof: "036",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    acceptedRows: [accepted.row],
    refusedRows,
    taxonomy: refusalFixtures.map((fixture) => ({
      id: fixture.id,
      code: fixture.expectedCode,
      continuationClass: fixture.continuationClass,
    })),
    assertions: {
      everyUnsafeFixtureRefused: refusedRows.every(
        (row) => !row.accepted && row.actualCode === row.expectedCode,
      ),
      noRefusedFixtureStartedMaterializer: refusedRows.every((row) => !row.materializerStarted),
      acceptedIdleReturnedCount3: accepted.target.count === 3,
      noForbiddenShortcutUsed: [...refusedRows, accepted.row].every(
        (row) => !Object.values(row.forbiddenShortcuts).some(Boolean),
      ),
      noProductSupportClaimed: [...refusedRows, accepted.row].every(
        (row) => !row.productSupportClaimed && !row.broadLevel5ImplementationClaimed,
      ),
    },
  };

  const summaryText = stableJson(checkedSummary);
  writeFileSync(join(work, "checked-summary.json"), summaryText);
  const checkedSummaryPath = join(proofDir, "checked-summary.json");
  if (process.env.UPDATE_PROOF_036_SUMMARY === "1" || !existsSync(checkedSummaryPath)) {
    writeFileSync(checkedSummaryPath, summaryText);
  } else {
    const expected = JSON.parse(readFileSync(checkedSummaryPath, "utf8")) as unknown;
    if (JSON.stringify(expected) !== JSON.stringify(checkedSummary)) {
      throw new Error(
        "proofs/036/checked-summary.json is stale; rerun with UPDATE_PROOF_036_SUMMARY=1",
      );
    }
  }
  console.log(
    JSON.stringify({
      refused: refusedRows.length,
      accepted: checkedSummary.acceptedRows.length,
      target: accepted.target,
      summary: checkedSummaryPath,
    }),
  );
  console.log(`node proper Level 5 restore refusal gauntlet proof passed: ${work}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
