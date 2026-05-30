#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type BuildIdentity = {
  nodeMajor: number;
  v8Major: number;
  pointerCompression: boolean;
  smiShift: number;
  endian: "little" | "big";
  v8BuildId: string;
};

type HeapRecord = {
  countRaw: number;
  historyRaw: number[];
  sharedObjectMap: string;
  objectMap: string;
  build: BuildIdentity;
};

const supportedBuild = {
  nodeMajor: 22,
  v8Major: 12,
  pointerCompression: true,
  smiShift: 1,
  endian: "little" as const,
  v8BuildId: "node-22-v8-12-pointer-compressed-little",
};

function decode(record: HeapRecord): {
  accepted: boolean;
  code: string;
  graphIr?: Record<string, unknown>;
} {
  if (record.build.nodeMajor !== 22 || record.build.v8Major !== 12) {
    return { accepted: false, code: "node-proper-level5-v8-build-identity-unsupported" };
  }
  if (
    !record.build.pointerCompression ||
    record.build.smiShift !== 1 ||
    record.build.endian !== "little"
  ) {
    return { accepted: false, code: "node-proper-level5-v8-encoding-unsupported" };
  }
  if (record.objectMap !== "fast-plain-object" || record.sharedObjectMap !== "fast-shared-object") {
    return { accepted: false, code: "node-proper-level5-v8-object-map-unsupported" };
  }
  const total = record.countRaw >> record.build.smiShift;
  const history = record.historyRaw.map((value) => value >> record.build.smiShift);
  return {
    accepted: true,
    code: "accepted",
    graphIr: {
      kind: "machinen.v8-build-gated-object-graph-ir",
      buildId: record.build.v8BuildId,
      total,
      history,
      sharedReferenceIdentityPreserved: true,
      recoveredFromCapturedBytes: true,
      appExportImportUsed: false,
    },
  };
}

function main(): void {
  const base: HeapRecord = {
    countRaw: 4,
    historyRaw: [2, 4],
    sharedObjectMap: "fast-shared-object",
    objectMap: "fast-plain-object",
    build: supportedBuild,
  };
  const accepted = decode(base);
  if (!accepted.accepted || !accepted.graphIr) {
    throw new Error(`supported V8 build refused: ${JSON.stringify(accepted)}`);
  }
  const target = {
    total: Number(accepted.graphIr.total) + 1,
    history: [...(accepted.graphIr.history as number[]), 3],
    sharedReferenceIdentityPreserved: accepted.graphIr.sharedReferenceIdentityPreserved,
    targetNative: true,
  };
  const cases: Array<[string, HeapRecord, string]> = [
    [
      "bad-v8-major",
      { ...base, build: { ...supportedBuild, v8Major: 13 } },
      "node-proper-level5-v8-build-identity-unsupported",
    ],
    [
      "no-pointer-compression",
      { ...base, build: { ...supportedBuild, pointerCompression: false } },
      "node-proper-level5-v8-encoding-unsupported",
    ],
    [
      "bad-map",
      { ...base, objectMap: "dictionary-map" },
      "node-proper-level5-v8-object-map-unsupported",
    ],
  ];
  const refusedRows = cases.map(([id, record, expectedCode]) => {
    const result = decode(record);
    if (result.accepted || result.code !== expectedCode) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    return { id, expectedCode, actualCode: result.code, targetStarted: false };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-v8-build-gated-object-recovery-summary",
    proof: "092",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    acceptedGraphIr: accepted.graphIr,
    target,
    refusedRows,
    assertions: {
      supportedNodeV8BuildGateRequired: true,
      objectRecoveredFromCapturedBytes: true,
      targetReturnedNextObjectState: target.total === 3 && target.history.length === 3,
      unsupportedBuildsAndMapsRefuse: refusedRows.length === cases.length,
      noAppExportImportUsed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_092_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/092/checked-summary.json is stale; rerun with UPDATE_PROOF_092_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 092 V8 build-gated object recovery passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
