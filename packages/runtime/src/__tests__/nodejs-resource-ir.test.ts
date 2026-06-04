import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NODEJS_RESOURCE_IR_INVALID_REFUSAL_CODE,
  NODEJS_RESOURCE_IR_KIND,
  NODEJS_RESOURCE_IR_MATERIALIZER_FILENAME,
  NODEJS_RESOURCE_IR_RESTORE_STRATEGY,
  NODEJS_RESOURCE_IR_UNSUPPORTED_REFUSAL_CODE,
  createNodejsResourceIrMaterializerModule,
  validateNodejsResourceIrDocument,
} from "../nodejs-resource-ir.ts";

function validIr() {
  return {
    kind: NODEJS_RESOURCE_IR_KIND,
    version: 1,
    runtime: { name: "node", sourceArch: "arm64" },
    captureBoundary: {
      sourceVmPauseRequired: true,
      stabilityPoint: "source-vm-paused",
      unsupportedPausedLiveStatePolicy: "refuse",
    },
    rows: [
      {
        id: "nodejs-resource-timer-schedule",
        kind: "timer-schedule-spec",
        reconstructable: true,
        captureBoundaryId: "portable-vm-pause-boundary.json",
        pausedEvidence: {
          sourceVmPaused: true,
          evidenceArtifact: "portable-vm-pause-boundary.json",
        },
        materializationPolicy: "target-native-reconstruct",
        semanticState: { intervalMs: 1000, nextPolicy: "restart-from-restore" },
      },
      {
        id: "nodejs-resource-http-listener-route",
        kind: "http-listener-route-spec",
        reconstructable: true,
        captureBoundaryId: "portable-vm-pause-boundary.json",
        pausedEvidence: {
          sourceVmPaused: true,
          evidenceArtifact: "portable-vm-pause-boundary.json",
        },
        materializationPolicy: "target-native-reconstruct",
        semanticState: { host: "127.0.0.1", portPolicy: "target-assigned", routes: ["/value"] },
      },
      {
        id: "nodejs-resource-declared-ffi-adapter",
        kind: "declared-ffi-adapter-spec",
        reconstructable: true,
        captureBoundaryId: "portable-vm-pause-boundary.json",
        pausedEvidence: {
          sourceVmPaused: true,
          evidenceArtifact: "portable-vm-pause-boundary.json",
        },
        materializationPolicy: "target-native-reconstruct",
        semanticState: {
          nativeAdapterReport: "nodejs-native-adapter-report.json",
          adapterId: "ffi-semantic-counter-v1",
          exportPolicy: "semantic-json-state-only",
          importPolicy: "target-native-adapter-import",
          rawPointerTransfer: false,
          rawHandleBytesRetained: false,
        },
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

describe("Node.js Resource IR product materializer", () => {
  it("validates reconstructable semantic resource IR", () => {
    expect(validateNodejsResourceIrDocument(validIr())).toMatchObject({
      accepted: true,
      refusalCode: null,
      rowCount: 3,
    });
    expect(NODEJS_RESOURCE_IR_RESTORE_STRATEGY).toBe(
      "materialize-nodejs-resource-ir-target-native",
    );
  });

  it("rejects unsupported, malformed, and raw native handle resource IR", () => {
    expect(validateNodejsResourceIrDocument({})).toMatchObject({
      accepted: false,
      refusalCode: NODEJS_RESOURCE_IR_INVALID_REFUSAL_CODE,
    });
    expect(
      validateNodejsResourceIrDocument({ ...validIr(), unsupported: [{ code: "x" }] }),
    ).toMatchObject({
      accepted: false,
      refusalCode: NODEJS_RESOURCE_IR_UNSUPPORTED_REFUSAL_CODE,
    });
    expect(
      validateNodejsResourceIrDocument({
        ...validIr(),
        rows: [{ ...validIr().rows[0], semanticState: { rawFd: 7 } }],
      }),
    ).toMatchObject({
      accepted: false,
      refusalCode: NODEJS_RESOURCE_IR_INVALID_REFUSAL_CODE,
    });
    expect(
      validateNodejsResourceIrDocument({
        ...validIr(),
        rows: [{ ...validIr().rows[2], semanticState: { rawPointer: "0x1234" } }],
      }),
    ).toMatchObject({
      accepted: false,
      refusalCode: NODEJS_RESOURCE_IR_INVALID_REFUSAL_CODE,
    });
    expect(
      validateNodejsResourceIrDocument({
        ...validIr(),
        rows: [{ ...validIr().rows[0], semanticState: { rawGcReachability: true } }],
      }),
    ).toMatchObject({
      accepted: false,
      refusalCode: NODEJS_RESOURCE_IR_INVALID_REFUSAL_CODE,
    });
    expect(
      validateNodejsResourceIrDocument({ ...validIr(), captureBoundary: undefined }),
    ).toMatchObject({
      accepted: false,
      refusalCode: NODEJS_RESOURCE_IR_INVALID_REFUSAL_CODE,
    });
  });

  it("generates a product-owned target-native resource materializer app", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-resource-ir-test-"));
    const irPath = join(dir, "nodejs-resource-ir.json");
    const targetDir = join(dir, "target");
    const materializer = join(dir, NODEJS_RESOURCE_IR_MATERIALIZER_FILENAME);
    writeFileSync(irPath, `${JSON.stringify(validIr(), null, 2)}\n`);
    writeFileSync(materializer, createNodejsResourceIrMaterializerModule());
    mkdirSync(targetDir, { recursive: true });

    const out = execFileSync(process.execPath, [
      materializer,
      "--ir",
      irPath,
      "--target-dir",
      targetDir,
      "--port",
      "18081",
    ]).toString("utf8");

    expect(JSON.parse(out)).toMatchObject({
      accepted: true,
      materializedRows: 3,
      claimGuard: { rawNativeHandleRestoreUsed: false, samePidContinuationClaimed: false },
    });
    expect(JSON.parse(readFileSync(join(targetDir, "node-resource-rows.json"), "utf8"))).toEqual(
      validIr().rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        semanticState: row.semanticState,
      })),
    );
    const app = readFileSync(join(targetDir, "node-resource-app.mjs"), "utf8");
    expect(app).toContain("/resources");
  });
});
