import { describe, expect, it } from "vitest";

import {
  buildGuestCriuSubstrateRow,
  summarizeGuestCriuSubstrateRows,
} from "../guest-criu-substrate.ts";

const base = {
  guestArch: "aarch64",
  kernelVersion: "6.12.20",
  criuVersion: "Version: 4.2",
  kernelFeatureProbeOutput: "Looks good.; seccomp_suspend is supported",
};

describe("guest CRIU substrate summaries", () => {
  it("records a completed same-guest C checkpoint/restore row", () => {
    const row = buildGuestCriuSubstrateRow({
      ...base,
      profile: "c-simple",
      checkpointLog: "criu dump completed for pid=761 pre=8",
      restoreLog: "criu restore completed for pid=761",
      verifierOutput: "pre=8 post=16 restored pid=761 tail counter=15",
      evidence: { preProgress: 8, postRestoreProgress: 16, restoredPid: 761 },
    });
    expect(row).toMatchObject({
      kind: "machinen.cross-arch-criu.guest-criu-substrate",
      profile: "c-simple",
      state: "completed",
      scope: {
        sameGuest: true,
        sameIsa: true,
        crossIsaCriuReplay: false,
        sourceIsaEmulationUsed: false,
      },
    });
  });

  it("records a stable JVM refusal without claiming migration", () => {
    const row = buildGuestCriuSubstrateRow({
      ...base,
      profile: "jvm-simple",
      checkpointLog: "not-run: java not present in base guest",
      restoreLog: "not-run: java not present in base guest",
      verifierOutput: "java command not found",
      state: "refused",
      refusalCode: "jvm-runtime-unavailable",
      remediation: "Install a supported JVM in the guest, then run the JVM CRIU profile.",
    });
    expect(row).toMatchObject({
      profile: "jvm-simple",
      state: "refused",
      refusalCode: "jvm-runtime-unavailable",
    });
  });

  it("validates completed and refused profile rows", () => {
    const summary = summarizeGuestCriuSubstrateRows([
      buildGuestCriuSubstrateRow({
        ...base,
        profile: "c-simple",
        checkpointLog: "dump ok",
        restoreLog: "restore ok",
        verifierOutput: "pre=8 post=16",
        evidence: { preCheckpointProgress: 8, postRestoreProgress: 16 },
      }),
      buildGuestCriuSubstrateRow({
        ...base,
        profile: "jvm-simple",
        checkpointLog: "not-run",
        restoreLog: "not-run",
        verifierOutput: "java command not found",
        state: "refused",
        refusalCode: "jvm-runtime-unavailable",
        remediation: "Install a supported JVM in the guest.",
      }),
    ]);
    expect(summary).toMatchObject({
      state: "completed",
      pass: true,
      completedRows: 1,
      refusedRows: 1,
    });
  });
});
