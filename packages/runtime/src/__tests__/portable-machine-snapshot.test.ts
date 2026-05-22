import { describe, expect, it } from "vitest";
import {
  PortableMachineSnapshotValidationError,
  crossIsaVmstateRestoreRefusal,
  validatePortableMachineSnapshotManifest,
  type PortableMachineSnapshotManifest,
} from "../portable-machine-snapshot.ts";

function manifest(
  overrides: Partial<PortableMachineSnapshotManifest> = {},
): PortableMachineSnapshotManifest {
  return {
    formatVersion: 1,
    kind: "machinen.portable-machine-snapshot",
    source: {
      guestArch: "arm64",
      vmstate: {
        rawRestore: "refused",
        refusalCode: "cross-isa-vmstate-restore-unsupported",
        reason: "raw arm64 kernel/vCPU/device state is not target amd64 state",
      },
      kernelState: "not-translated",
      deviceState: "not-translated",
    },
    target: {
      guestArch: "amd64",
      mode: "target-isa-vm-process-restore",
      execution: "target-native",
    },
    payload: {
      nativeProcessImage: {
        kind: "machinen.native-process-image",
        path: "native-process/",
      },
      resourceModel: "explicit-recipes-only",
    },
    refusals: {
      vocabularyVersion: 1,
      refusals: [crossIsaVmstateRestoreRefusal("arm64", "amd64")],
    },
    ...overrides,
  };
}

describe("portable machine snapshot boundary", () => {
  it("accepts the narrow cross-ISA target-VM process-restore metadata shape", () => {
    expect(validatePortableMachineSnapshotManifest(manifest())).toMatchObject({
      kind: "machinen.portable-machine-snapshot",
      source: {
        guestArch: "arm64",
        vmstate: { rawRestore: "refused" },
        kernelState: "not-translated",
        deviceState: "not-translated",
      },
      target: {
        guestArch: "amd64",
        mode: "target-isa-vm-process-restore",
        execution: "target-native",
      },
      payload: {
        nativeProcessImage: { kind: "machinen.native-process-image" },
        resourceModel: "explicit-recipes-only",
      },
    });
  });

  it("records a precise raw cross-ISA vmstate refusal", () => {
    expect(crossIsaVmstateRestoreRefusal("arm64", "amd64")).toEqual({
      code: "cross-isa-vmstate-restore-unsupported",
      message: "raw whole-VM vmstate cannot be restored across guest ISAs",
      detail: {
        sourceArch: "arm64",
        targetArch: "amd64",
        requiredPath: "target-isa-vm-process-restore",
      },
    });
  });

  it("refuses same-ISA metadata because this contract is specifically cross-ISA", () => {
    expect(() =>
      validatePortableMachineSnapshotManifest(
        manifest({
          target: {
            guestArch: "arm64",
            mode: "target-isa-vm-process-restore",
            execution: "target-native",
          },
        }),
      ),
    ).toThrow(PortableMachineSnapshotValidationError);
  });

  it("refuses metadata that tries to replay raw vmstate", () => {
    const unsafe = manifest() as unknown as { source: { vmstate: { rawRestore: string } } };
    unsafe.source.vmstate.rawRestore = "translated";

    expect(() => validatePortableMachineSnapshotManifest(unsafe)).toThrow(
      /rawRestore must be "refused"/,
    );
  });

  it("refuses metadata that would use source ISA or sidecar execution", () => {
    expect(() =>
      validatePortableMachineSnapshotManifest(
        manifest({
          target: {
            guestArch: "amd64",
            mode: "target-isa-vm-process-restore",
            execution: "target-native",
          },
        }),
      ),
    ).not.toThrow();

    const unsafe = manifest() as unknown as { target: { execution: string } };
    unsafe.target.execution = "source-isa-emulation";
    expect(() => validatePortableMachineSnapshotManifest(unsafe)).toThrow(
      /execution must be "target-native"/,
    );
  });
});
