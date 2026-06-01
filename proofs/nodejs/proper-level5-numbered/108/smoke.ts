#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type Shape = { mapId: string; kind: string; fields: string[]; elementsKind?: string };
type Table = { buildId: string; shapes: Shape[] };
type Result = {
  accepted: boolean;
  targetStarted: boolean;
  shapeCount?: number;
  supportedKinds?: string[];
  refusal?: { code: string; mapId?: string };
};
function validate(table: Table): Result {
  if (table.buildId !== "node-22-v8-12-pointer-compressed") {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-v8-shape-build-unsupported" },
    };
  }
  const allowed = new Set([
    "fast-plain-object",
    "fast-packed-array",
    "internalized-string",
    "closure-context",
  ]);
  for (const shape of table.shapes) {
    if (!allowed.has(shape.kind)) {
      return {
        accepted: false,
        targetStarted: false,
        refusal: { code: "node-proper-level5-v8-shape-kind-unsupported", mapId: shape.mapId },
      };
    }
    if (new Set(shape.fields).size !== shape.fields.length) {
      return {
        accepted: false,
        targetStarted: false,
        refusal: { code: "node-proper-level5-v8-shape-duplicate-field", mapId: shape.mapId },
      };
    }
  }
  return {
    accepted: true,
    targetStarted: false,
    shapeCount: table.shapes.length,
    supportedKinds: table.shapes.map((shape) => shape.kind),
  };
}
function main(): void {
  const table: Table = {
    buildId: "node-22-v8-12-pointer-compressed",
    shapes: [
      { mapId: "m-object", kind: "fast-plain-object", fields: ["count", "label"] },
      {
        mapId: "m-array",
        kind: "fast-packed-array",
        fields: ["length"],
        elementsKind: "smi-or-tagged",
      },
      { mapId: "m-string", kind: "internalized-string", fields: ["length", "hash"] },
      { mapId: "m-context", kind: "closure-context", fields: ["count", "label", "enabled"] },
    ],
  };
  const accepted = validate(table);
  if (!accepted.accepted || accepted.shapeCount !== 4) {
    throw new Error(`shape table refused: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, Table, string]> = [
    [
      "bad-build",
      { ...table, buildId: "node-23-v8-13" },
      "node-proper-level5-v8-shape-build-unsupported",
    ],
    [
      "bad-kind",
      { ...table, shapes: [{ mapId: "m-proxy", kind: "proxy", fields: [] }] },
      "node-proper-level5-v8-shape-kind-unsupported",
    ],
    [
      "duplicate-field",
      { ...table, shapes: [{ mapId: "m-dupe", kind: "fast-plain-object", fields: ["x", "x"] }] },
      "node-proper-level5-v8-shape-duplicate-field",
    ],
  ];
  const refusedRows = cases.map(([id, input, expectedCode]) => {
    const result = validate(input);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} failed: ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.refusal.code,
      mapId: result.refusal.mapId ?? null,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-v8-map-shape-table-summary",
    proof: "108",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      supportedShapeTableExpanded: accepted.shapeCount === 4,
      unsupportedShapesRefuseBeforeTargetStart: refusedRows.every(
        (row) => row.targetStarted === false,
      ),
      nodeV8BuildGateRequired: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_108_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/108/checked-summary.json is stale; rerun with UPDATE_PROOF_108_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ shapes: accepted.shapeCount, refused: refusedRows.length }));
  console.log("proof 108 V8 shape table passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
