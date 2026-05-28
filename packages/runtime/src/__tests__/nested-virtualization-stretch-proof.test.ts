import { describe, expect, it } from "vitest";
import {
  buildNestedVirtualizationStretchProofRow,
  summarizeNestedVirtualizationStretchProofRows,
} from "../nested-virtualization-stretch-proof.ts";
import { performSnapshot } from "../vm/snapshot.ts";

const snapshotForkRefusal = {
  snapshotForkRefusalCode: "BOOT_VMSTATE_UNSUPPORTED",
  snapshotForkRemediation:
    "Snapshot/fork VMs created inside the nested guest instead of snapshotting the nested-enabled L1.",
};

describe("nested virtualization stretch proof", () => {
  it("accepts a Firecracker L2 stretch-demo row without product support", () => {
    const row = buildNestedVirtualizationStretchProofRow({
      classification: "stretch-demo",
      l0HostArch: "arm64",
      l1GuestArch: "aarch64",
      l2GuestArch: "aarch64",
      providerMode: "darwin-hvf -> guest-kvm -> firecracker-kvm",
      accelerated: true,
      emulated: false,
      nestedVerifierOutput: "l1-arch=aarch64; firecracker-nested-ok; l2-arch=aarch64",
      ...snapshotForkRefusal,
    });

    expect(row.migrationCompleted).toBe(false);
    expect(row.scope.productSupportClaimed).toBe(false);
    expect(row.scope.providerSnapshotForkSafe).toBe(false);
    expect(summarizeNestedVirtualizationStretchProofRows([row])).toMatchObject({
      pass: true,
      rowCount: 1,
      failures: [],
    });
  });

  it("requires stable refusal data for skipped or refused hosts", () => {
    const bad = buildNestedVirtualizationStretchProofRow({
      classification: "skipped",
      l0HostArch: "x64",
      l1GuestArch: "unavailable",
      l2GuestArch: "unavailable",
      providerMode: "linux-kvm-unavailable",
      accelerated: false,
      emulated: false,
      nestedVerifierOutput: "nested virtualization unavailable",
      ...snapshotForkRefusal,
    });
    expect(summarizeNestedVirtualizationStretchProofRows([bad]).failures).toContain(
      "non-stretch nested row is missing refusal code or remediation",
    );
  });

  it("refuses provider-level snapshots for nested-enabled VMs", async () => {
    await expect(
      performSnapshot(
        {
          pid: process.pid,
          diskPath: "/tmp/unused-disk.img",
          nested: true,
          execRaw: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          wait: async () => ({ code: 0, signal: null }),
          kill: async () => {},
          teeGuestConsole: undefined,
          errorOutput: async () => "",
        },
        { outDir: "/tmp/unused-nested-snapshot" },
      ),
    ).rejects.toMatchObject({ code: "BOOT_VMSTATE_UNSUPPORTED" });
  });
});
