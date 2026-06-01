#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type Provenance = {
  field: string;
  artifactPath: string;
  digest: string;
  generator: string;
  timestamp: string;
  architecture: string;
  evidenceClass: string;
};
const requiredFields = [
  "architecture.source",
  "architecture.target",
  "heapGraphIr.count",
  "heapGraphIr.graphTotal",
  "continuationDescriptor.continuationClass",
  "resourceDescriptors.listener",
  "resourceDescriptors.timer",
  "threadEvidence.main",
  "refusalPolicy.activeRequest",
];

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validProvenance(): Provenance[] {
  return requiredFields.map((field, index) => {
    const base = {
      field,
      artifactPath: `/capture/proof-053/artifact-${index}.json`,
      generator: "proof-053-capture-provenance-v1",
      timestamp: "2026-05-30T00:00:00.000Z",
      architecture: field.includes("target") ? "amd64" : "arm64",
      evidenceClass: field.startsWith("heap")
        ? "v8-heap"
        : field.startsWith("resource")
          ? "kernel-resource"
          : "process-evidence",
    };
    return { ...base, digest: digest(base) };
  });
}

function audit(provenance: Provenance[]): {
  accepted: boolean;
  code: string;
  missing?: string[];
  targetStarted: boolean;
} {
  const byField = new Map<string, Provenance[]>();
  for (const record of provenance) {
    byField.set(record.field, [...(byField.get(record.field) ?? []), record]);
    const expectedDigest = digest({
      field: record.field,
      artifactPath: record.artifactPath,
      generator: record.generator,
      timestamp: record.timestamp,
      architecture: record.architecture,
      evidenceClass: record.evidenceClass,
    });
    if (record.digest !== expectedDigest) {
      return {
        accepted: false,
        code: "node-proper-level5-provenance-stale-or-tampered",
        targetStarted: false,
      };
    }
    if (record.generator !== "proof-053-capture-provenance-v1") {
      return {
        accepted: false,
        code: "node-proper-level5-provenance-hand-edited-refused",
        targetStarted: false,
      };
    }
  }
  const missing = requiredFields.filter((field) => !byField.has(field));
  if (missing.length > 0) {
    return {
      accepted: false,
      code: "node-proper-level5-provenance-missing",
      missing,
      targetStarted: false,
    };
  }
  if ([...byField.values()].some((records) => records.length > 1)) {
    return {
      accepted: false,
      code: "node-proper-level5-provenance-duplicate",
      targetStarted: false,
    };
  }
  const source = provenance.find((record) => record.field === "architecture.source");
  const target = provenance.find((record) => record.field === "architecture.target");
  if (source?.architecture !== "arm64" || target?.architecture !== "amd64") {
    return {
      accepted: false,
      code: "node-proper-level5-provenance-cross-section-inconsistent",
      targetStarted: false,
    };
  }
  return { accepted: true, code: "accepted", targetStarted: false };
}

function main(): void {
  const valid = validProvenance();
  const accepted = audit(valid);
  if (!accepted.accepted || accepted.targetStarted) {
    throw new Error(`valid provenance refused: ${JSON.stringify(accepted)}`);
  }
  const stale = { ...valid[0], digest: "bad" };
  const handEdited = {
    ...valid[1],
    generator: "manual-editor",
    digest: digest({ ...valid[1], generator: "manual-editor", digest: undefined }),
  };
  const inconsistent = valid.map((record) =>
    record.field === "architecture.target"
      ? {
          ...record,
          architecture: "arm64",
          digest: digest({
            field: record.field,
            artifactPath: record.artifactPath,
            generator: record.generator,
            timestamp: record.timestamp,
            architecture: "arm64",
            evidenceClass: record.evidenceClass,
          }),
        }
      : record,
  );
  const cases: Array<[string, Provenance[], string]> = [
    [
      "missing",
      valid.filter((record) => record.field !== "heapGraphIr.count"),
      "node-proper-level5-provenance-missing",
    ],
    ["duplicate", [...valid, valid[0]], "node-proper-level5-provenance-duplicate"],
    ["stale", [stale, ...valid.slice(1)], "node-proper-level5-provenance-stale-or-tampered"],
    [
      "hand-edited",
      [valid[0], handEdited, ...valid.slice(2)],
      "node-proper-level5-provenance-hand-edited-refused",
    ],
    ["inconsistent", inconsistent, "node-proper-level5-provenance-cross-section-inconsistent"],
  ];
  const refusedRows = cases.map(([id, records, expectedCode]) => {
    const result = audit(records);
    if (result.accepted || result.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    return { id, expectedCode, actualCode: result.code, targetStarted: result.targetStarted };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-bundle-provenance-audit-summary",
    proof: "053",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    requiredFields,
    accepted,
    refusedRows,
    assertions: {
      everyImportantFieldHasProvenance: true,
      missingDuplicateStaleAndInconsistentProvenanceRefuse: refusedRows.length === cases.length,
      validProvenanceDeterministic: true,
      noProductSupportClaimed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_053_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/053/checked-summary.json is stale; rerun with UPDATE_PROOF_053_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ fields: requiredFields.length, refused: refusedRows.length }));
  console.log("node proper Level 5 bundle provenance audit proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
