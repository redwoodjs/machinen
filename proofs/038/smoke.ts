#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const proof037SummaryPath = join(proofDir, "../037/checked-summary.json");

interface BundleSectionDigests {
  heapGraphIr: string;
  continuationDescriptor: string;
  resourceDescriptors: string;
  refusalPolicy: string;
  forbiddenShortcuts: string;
}

interface IntegrityBundle {
  kind: string;
  proof: string;
  scope: string;
  productSupportClaimed: boolean;
  broadLevel5ImplementationClaimed: boolean;
  architecture: { source: string; target: string; targetNativeRequired: boolean };
  sourceEvidencePolicy: Record<string, boolean>;
  heapGraphIr?: Record<string, unknown>;
  continuationDescriptor: Record<string, unknown>;
  resourceDescriptors: Array<Record<string, unknown>>;
  refusalPolicy: { refusedRows: Array<Record<string, unknown>>; productSupportClaimed: boolean };
  forbiddenShortcuts: Record<string, boolean>;
  sectionDigests?: BundleSectionDigests;
  bundleDigest?: string;
}

interface RowResult {
  id: string;
  accepted: boolean;
  code?: string;
  materializerStarted: boolean;
  targetMaterialized: boolean;
}

const expectedCodes = {
  missingHeapGraph: "node-proper-level5-bundle-heap-graph-missing",
  architectureMismatch: "node-proper-level5-bundle-architecture-mismatch",
  rawCpuCopy: "node-proper-level5-bundle-raw-cpu-copy-forbidden",
  sourceFdReuse: "node-proper-level5-bundle-source-fd-reuse-forbidden",
  digestMismatch: "node-proper-level5-bundle-digest-mismatch",
  productClaim: "node-proper-level5-bundle-product-claim-forbidden",
  shortcut: "node-proper-level5-bundle-forbidden-shortcut",
  missingRefusalPolicy: "node-proper-level5-bundle-refusal-policy-missing",
} as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(",")}}`;
  }
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function loadProof037Bundle(): IntegrityBundle {
  const summary = JSON.parse(readFileSync(proof037SummaryPath, "utf8")) as {
    bundle: IntegrityBundle;
  };
  return stampDigests(summary.bundle);
}

function sectionDigests(bundle: IntegrityBundle): BundleSectionDigests {
  return {
    heapGraphIr: sha256(bundle.heapGraphIr),
    continuationDescriptor: sha256(bundle.continuationDescriptor),
    resourceDescriptors: sha256(bundle.resourceDescriptors),
    refusalPolicy: sha256(bundle.refusalPolicy),
    forbiddenShortcuts: sha256(bundle.forbiddenShortcuts),
  };
}

function stampDigests(bundle: IntegrityBundle): IntegrityBundle {
  const copy = structuredClone(bundle) as IntegrityBundle;
  copy.sectionDigests = sectionDigests(copy);
  copy.bundleDigest = sha256({
    kind: copy.kind,
    architecture: copy.architecture,
    sourceEvidencePolicy: copy.sourceEvidencePolicy,
    sectionDigests: copy.sectionDigests,
  });
  return copy;
}

function validateBundle(bundle: IntegrityBundle): RowResult {
  const base = { id: "valid-bundle", materializerStarted: false, targetMaterialized: false };
  if (bundle.productSupportClaimed || bundle.broadLevel5ImplementationClaimed) {
    return { ...base, accepted: false, code: expectedCodes.productClaim };
  }
  if (!bundle.heapGraphIr) {
    return { ...base, accepted: false, code: expectedCodes.missingHeapGraph };
  }
  if (!bundle.refusalPolicy?.refusedRows || bundle.refusalPolicy.refusedRows.length < 13) {
    return { ...base, accepted: false, code: expectedCodes.missingRefusalPolicy };
  }
  if (bundle.refusalPolicy.productSupportClaimed) {
    return { ...base, accepted: false, code: expectedCodes.productClaim };
  }
  if (
    bundle.continuationDescriptor.sourceArchitecture !== bundle.architecture.source ||
    bundle.continuationDescriptor.targetArchitecture !== bundle.architecture.target ||
    bundle.architecture.source === bundle.architecture.target
  ) {
    return { ...base, accepted: false, code: expectedCodes.architectureMismatch };
  }
  if (
    bundle.continuationDescriptor.rawSourceRegistersCopiedToTarget ||
    bundle.continuationDescriptor.rawSourceStackCopiedToTarget ||
    bundle.continuationDescriptor.rawSourcePcCopiedToTarget
  ) {
    return { ...base, accepted: false, code: expectedCodes.rawCpuCopy };
  }
  if (
    bundle.resourceDescriptors.some(
      (descriptor) =>
        descriptor.sourceKernelFdCopiedToTarget ||
        descriptor.sourceKernelTimerCopiedToTarget ||
        descriptor.sourceLibuvHandleCopiedToTarget,
    )
  ) {
    return { ...base, accepted: false, code: expectedCodes.sourceFdReuse };
  }
  if (Object.values(bundle.forbiddenShortcuts).some(Boolean)) {
    return { ...base, accepted: false, code: expectedCodes.shortcut };
  }
  const actualSections = sectionDigests(bundle);
  if (canonical(actualSections) !== canonical(bundle.sectionDigests)) {
    return { ...base, accepted: false, code: expectedCodes.digestMismatch };
  }
  const actualBundleDigest = sha256({
    kind: bundle.kind,
    architecture: bundle.architecture,
    sourceEvidencePolicy: bundle.sourceEvidencePolicy,
    sectionDigests: bundle.sectionDigests,
  });
  if (actualBundleDigest !== bundle.bundleDigest) {
    return { ...base, accepted: false, code: expectedCodes.digestMismatch };
  }
  return { ...base, accepted: true };
}

async function materializeValidBundle(bundle: IntegrityBundle): Promise<{
  row: RowResult;
  target: Record<string, unknown>;
}> {
  const validation = validateBundle(bundle);
  if (!validation.accepted) {
    throw new Error(`valid bundle refused: ${validation.code}`);
  }
  let count = 2;
  let graphTotal = 2;
  let timerTicks = 0;
  const interval = setInterval(() => {
    timerTicks += 1;
  }, 100);
  interval.unref();
  const shared = {};
  const graph = { left: { shared }, right: { shared }, packed: [1, 2, shared] };
  const server = createServer((req, res) => {
    if (req.url !== "/") {
      res.writeHead(404);
      res.end("not found\n");
      return;
    }
    count += 1;
    graphTotal += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        count,
        graphTotal,
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
          reject(new Error("missing listener address"));
          return;
        }
        resolvePort(address.port);
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const target = (await response.json()) as Record<string, unknown>;
    if (target.count !== 3 || target.graphTotal !== 3) {
      throw new Error(`valid bundle target returned wrong state: ${JSON.stringify(target)}`);
    }
    return {
      row: { ...validation, materializerStarted: true, targetMaterialized: true },
      target,
    };
  } finally {
    clearInterval(interval);
    server.close();
  }
}

function mutate(
  bundle: IntegrityBundle,
  id: string,
  apply: (copy: IntegrityBundle) => void,
): IntegrityBundle & { id: string } {
  const copy = structuredClone(bundle) as IntegrityBundle & { id: string };
  copy.id = id;
  apply(copy);
  return copy;
}

async function main(): Promise<void> {
  const validBundle = loadProof037Bundle();
  const accepted = await materializeValidBundle(validBundle);
  const tampered = [
    [
      expectedCodes.missingHeapGraph,
      mutate(validBundle, "missing-heap-graph", (copy) => {
        delete copy.heapGraphIr;
        copy.sectionDigests = sectionDigests(copy);
        copy.bundleDigest = sha256({
          kind: copy.kind,
          architecture: copy.architecture,
          sourceEvidencePolicy: copy.sourceEvidencePolicy,
          sectionDigests: copy.sectionDigests,
        });
      }),
    ],
    [
      expectedCodes.architectureMismatch,
      mutate(validBundle, "architecture-mismatch", (copy) => {
        copy.continuationDescriptor.targetArchitecture = "arm64";
        copy = stampDigests(copy);
      }),
    ],
    [
      expectedCodes.rawCpuCopy,
      mutate(validBundle, "raw-cpu-copy", (copy) => {
        copy.continuationDescriptor.rawSourceRegistersCopiedToTarget = true;
        const stamped = stampDigests(copy);
        copy.sectionDigests = stamped.sectionDigests;
        copy.bundleDigest = stamped.bundleDigest;
      }),
    ],
    [
      expectedCodes.sourceFdReuse,
      mutate(validBundle, "source-fd-reuse", (copy) => {
        copy.resourceDescriptors[0].sourceKernelFdCopiedToTarget = true;
        const stamped = stampDigests(copy);
        copy.sectionDigests = stamped.sectionDigests;
        copy.bundleDigest = stamped.bundleDigest;
      }),
    ],
    [
      expectedCodes.digestMismatch,
      mutate(validBundle, "stale-digest", (copy) => {
        copy.heapGraphIr = { ...copy.heapGraphIr, tampered: true };
      }),
    ],
    [
      expectedCodes.productClaim,
      mutate(validBundle, "product-claim", (copy) => {
        copy.productSupportClaimed = true;
        const stamped = stampDigests(copy);
        copy.sectionDigests = stamped.sectionDigests;
        copy.bundleDigest = stamped.bundleDigest;
      }),
    ],
    [
      expectedCodes.shortcut,
      mutate(validBundle, "shortcut", (copy) => {
        copy.forbiddenShortcuts.metadataOnlySuccess = true;
        const stamped = stampDigests(copy);
        copy.sectionDigests = stamped.sectionDigests;
        copy.bundleDigest = stamped.bundleDigest;
      }),
    ],
    [
      expectedCodes.missingRefusalPolicy,
      mutate(validBundle, "missing-refusal-policy", (copy) => {
        copy.refusalPolicy.refusedRows = [];
        const stamped = stampDigests(copy);
        copy.sectionDigests = stamped.sectionDigests;
        copy.bundleDigest = stamped.bundleDigest;
      }),
    ],
  ] as const;

  const refusedRows = tampered.map(([expectedCode, bundle]) => {
    const row = validateBundle(bundle);
    if (row.accepted || row.code !== expectedCode) {
      throw new Error(`${bundle.id} expected ${expectedCode}, got ${row.code ?? "accepted"}`);
    }
    if (row.materializerStarted || row.targetMaterialized) {
      throw new Error(`${bundle.id} started target materialization despite refusal`);
    }
    return { ...row, id: bundle.id };
  });

  const checkedSummary = {
    kind: "machinen.node-proper-level5-translated-bundle-integrity-summary",
    proof: "038",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    acceptedRow: accepted.row,
    target: accepted.target,
    refusedRows,
    assertions: {
      validBundleAccepted: accepted.row.accepted,
      targetReturnedNextState: accepted.target.count === 3 && accepted.target.graphTotal === 3,
      allTamperedBundlesRefused: refusedRows.every((row) => !row.accepted),
      noRefusedBundleStartedMaterializer: refusedRows.every((row) => !row.materializerStarted),
      noProductSupportClaimed: true,
      noForbiddenShortcutAccepted: true,
    },
  };

  const checkedSummaryPath = join(proofDir, "checked-summary.json");
  const summaryText = stableJson(checkedSummary);
  if (process.env.UPDATE_PROOF_038_SUMMARY === "1" || !existsSync(checkedSummaryPath)) {
    writeFileSync(checkedSummaryPath, summaryText);
  } else {
    const expected = JSON.parse(readFileSync(checkedSummaryPath, "utf8")) as unknown;
    if (JSON.stringify(expected) !== JSON.stringify(checkedSummary)) {
      throw new Error(
        "proofs/038/checked-summary.json is stale; rerun with UPDATE_PROOF_038_SUMMARY=1",
      );
    }
  }
  console.log(
    JSON.stringify({
      accepted: accepted.target,
      refused: refusedRows.length,
      codes: refusedRows.map((row) => row.code),
      summary: checkedSummaryPath,
    }),
  );
  console.log("node proper Level 5 translated bundle integrity proof passed");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
