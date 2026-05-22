import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  completePortableMachineVmRestoreProof,
  planPortableMachineTargetRestoreDescriptor,
  planPortableMachineVmRestoreProof,
  type PortableMachineVmRestoreProofPlan,
} from "../portable-machine-restore-proof.ts";

const continuation = {
  codeFile: "/tmp/target.bin",
  fileOffset: 0,
  codeSize: 9,
  targetAddress: "0x700300000000",
  timeoutSeconds: 5,
  stackTargetStart: "0x500000000000",
  stackSize: 65_536,
  stackPointer: "0x500000010000",
};

describe("portable machine VM restore proof", () => {
  it("combines continuation, memory, and fd-table recipes into one descriptor", () => {
    const plan = planPortableMachineTargetRestoreDescriptor({
      continuation,
      fdTable: {
        entries: [],
        resources: [],
        targetGuestResources: [
          {
            kind: "reopen-file",
            fd: 7,
            path: "/tmp/data.txt",
            offset: 2,
            access: 0,
            closeOnExec: true,
          },
          { kind: "synthetic-empty-eventfd", fd: 8, closeOnExec: true },
        ],
        refusals: [],
      },
      memory: {
        entries: [
          {
            kind: "copy-captured-bytes",
            mapping: "heap",
            targetStart: "0x600000000000",
            sizeBytes: 4096,
            permissions: "rw-p",
            sourceFile: "/tmp/native-memory.bin",
            sourceOffset: 0,
            provenance: "native-process-image",
          },
        ],
        refusals: [],
      },
    });

    expect(plan).toMatchObject({
      state: "ready",
      memoryEntryCount: 1,
      fdRecipeCount: 2,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      descriptor: {
        targetArch: "amd64",
        continuation,
        resources: [
          { kind: "reopen-file", fd: 7 },
          { kind: "synthetic-empty-eventfd", fd: 8 },
        ],
        memory: [{ kind: "copy-captured-bytes", mapping: "heap" }],
      },
    });
  });

  it("refuses a combined descriptor before target execution when memory or fd state is unsafe", () => {
    const plan = planPortableMachineTargetRestoreDescriptor({
      continuation,
      fdTable: {
        entries: [],
        resources: [],
        targetGuestResources: [],
        refusals: [{ code: "target-fd-table-duplicate", message: "fd 3 is duplicated" }],
      },
      memory: {
        entries: [],
        refusals: [
          {
            code: "target-module-bytes-missing",
            message: "executable source bytes are not target code",
          },
        ],
      },
    });

    expect(plan).toMatchObject({
      state: "refused",
      memoryEntryCount: 0,
      fdRecipeCount: 0,
      refusals: [{ code: "target-fd-table-duplicate" }, { code: "target-module-bytes-missing" }],
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    });
    expect("descriptor" in plan).toBe(false);
  });

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
      descriptorGateCompleted: false,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    };

    expect(
      completePortableMachineVmRestoreProof(plan, {
        exitCode: 0,
        migrationCompleted: true,
        descriptorGateCompleted: true,
        targetVerifierResult: "passed",
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      }),
    ).toMatchObject({
      state: "completed",
      migrationCompleted: true,
      descriptorGateCompleted: true,
    });

    expect(
      completePortableMachineVmRestoreProof(plan, {
        exitCode: 0,
        migrationCompleted: true,
        descriptorGateCompleted: true,
        targetVerifierResult: "passed",
        sourceTextReusedAsTargetCode: true,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      }),
    ).toMatchObject({ state: "ready", migrationCompleted: false, descriptorGateCompleted: true });

    expect(
      completePortableMachineVmRestoreProof(plan, {
        exitCode: 0,
        migrationCompleted: true,
        descriptorGateCompleted: false,
        targetVerifierResult: "failed",
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      }),
    ).toMatchObject({
      state: "ready",
      migrationCompleted: false,
      descriptorGateCompleted: false,
    });
  });
});
