import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NODEJS_MEMORY_IR_INVALID_REFUSAL_CODE,
  NODEJS_MEMORY_IR_KIND,
  NODEJS_MEMORY_IR_MATERIALIZER_FILENAME,
  NODEJS_MEMORY_IR_RESTORE_STRATEGY,
  NODEJS_MEMORY_IR_UNSUPPORTED_REFUSAL_CODE,
  createNodejsMemoryIrMaterializerModule,
  validateNodejsMemoryIrDocument,
} from "../nodejs-memory-ir.ts";

function validIr() {
  return {
    kind: NODEJS_MEMORY_IR_KIND,
    version: 1,
    runtime: { name: "node", sourceArch: "arm64" },
    rows: [
      {
        id: "038-memory-real-array",
        shape: "array",
        semanticState: { kind: "array", values: [1, 2, 3], sum: 6 },
        anchors: { values: "array-values:1,2,3" },
      },
      {
        id: "040-memory-real-string",
        shape: "string",
        semanticState: { kind: "string", value: "portable" },
        anchors: { value: "real-string-value:portable" },
      },
    ],
    unsupported: [],
    claimGuard: {
      arbitraryNodeProcessRestoreClaimed: false,
      rawV8HeapRestoreUsed: false,
      sourceIsaEmulationUsed: false,
    },
  };
}

describe("Node.js Memory IR product materializer", () => {
  it("validates semantic Memory IR for product materialization", () => {
    expect(validateNodejsMemoryIrDocument(validIr())).toMatchObject({
      accepted: true,
      refusalCode: null,
      rowCount: 2,
    });
    expect(NODEJS_MEMORY_IR_RESTORE_STRATEGY).toBe("materialize-nodejs-memory-ir-target-native");
  });

  it("rejects malformed, unsupported, and raw heap style IR", () => {
    expect(validateNodejsMemoryIrDocument({})).toMatchObject({
      accepted: false,
      refusalCode: NODEJS_MEMORY_IR_INVALID_REFUSAL_CODE,
    });
    expect(
      validateNodejsMemoryIrDocument({ ...validIr(), unsupported: [{ code: "x" }] }),
    ).toMatchObject({
      accepted: false,
      refusalCode: NODEJS_MEMORY_IR_UNSUPPORTED_REFUSAL_CODE,
    });
    expect(
      validateNodejsMemoryIrDocument({
        ...validIr(),
        rows: [{ ...validIr().rows[0], rawV8HeapBytes: "not-semantic" }],
      }),
    ).toMatchObject({
      accepted: false,
      refusalCode: NODEJS_MEMORY_IR_INVALID_REFUSAL_CODE,
    });
  });

  it("generates a product-owned target-native materializer app", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-memory-ir-test-"));
    const irPath = join(dir, "nodejs-memory-ir.json");
    const targetDir = join(dir, "target");
    const materializer = join(dir, NODEJS_MEMORY_IR_MATERIALIZER_FILENAME);
    writeFileSync(irPath, `${JSON.stringify(validIr(), null, 2)}\n`);
    writeFileSync(materializer, createNodejsMemoryIrMaterializerModule());
    mkdirSync(targetDir, { recursive: true });

    const out = execFileSync(process.execPath, [
      materializer,
      "--ir",
      irPath,
      "--target-dir",
      targetDir,
      "--port",
      "18080",
    ]).toString("utf8");

    expect(JSON.parse(out)).toMatchObject({
      accepted: true,
      materializedRows: 2,
      claimGuard: { rawV8HeapRestoreUsed: false, samePidContinuationClaimed: false },
    });
    expect(JSON.parse(readFileSync(join(targetDir, "node-memory-state.json"), "utf8"))).toEqual(
      validIr().rows[0]!.semanticState,
    );
    expect(JSON.parse(readFileSync(join(targetDir, "node-memory-rows.json"), "utf8"))).toEqual(
      validIr().rows.map((row) => ({
        id: row.id,
        shape: row.shape,
        semanticState: row.semanticState,
      })),
    );
    const app = readFileSync(join(targetDir, "node-memory-app.mjs"), "utf8");
    expect(app).toContain("/state");
    expect(app).toContain("/rows");
  });
});
