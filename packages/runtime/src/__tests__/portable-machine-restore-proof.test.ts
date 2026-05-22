import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  completePortableMachineVmRestoreProof,
  planPortableMachineVmRestoreProof,
  type PortableMachineVmRestoreProofPlan,
} from "../portable-machine-restore-proof.ts";

describe("portable machine VM restore proof", () => {
  it("skips until a portable machine bundle and target bytes are provided", () => {
    expect(planPortableMachineVmRestoreProof({})).toMatchObject({
      state: "skipped",
      skipReason: "--bundle-dir is required",
      migrationCompleted: false,
    });
  });

  it("refuses target continuation bytes outside the portable bundle", () => {
    const root = mkdtempSync(join(tmpdir(), "portable-machine-vm-proof-"));
    const bundle = join(root, "bundle");
    const outside = join(root, "target.bin");
    mkdirSync(bundle);
    writeFileSync(outside, Buffer.from([0xc3]));

    expect(
      planPortableMachineVmRestoreProof({ bundleDir: bundle, targetCodeFile: outside }),
    ).toMatchObject({
      state: "refused",
      refusal: { code: "target-code-outside-portable-bundle" },
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    });
  });

  it("marks migrationCompleted only after target-native guest success", () => {
    const plan: PortableMachineVmRestoreProofPlan = {
      phase: "portable-machine-vm-restore-proof",
      state: "ready",
      targetVmRequired: true,
      targetNativeCompletionRequired: true,
      migrationCompleted: false,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    };

    expect(
      completePortableMachineVmRestoreProof(plan, {
        exitCode: 0,
        migrationCompleted: true,
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      }),
    ).toMatchObject({ state: "completed", migrationCompleted: true });

    expect(
      completePortableMachineVmRestoreProof(plan, {
        exitCode: 0,
        migrationCompleted: true,
        sourceTextReusedAsTargetCode: true,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      }),
    ).toMatchObject({ state: "ready", migrationCompleted: false });
  });
});
