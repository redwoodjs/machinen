import { describe, expect, it } from "vitest";

import {
  buildGuestCheckpointSubstrateRow,
  summarizeGuestCheckpointSubstrateRows,
} from "../guest-checkpoint-substrate.ts";

const base = {
  guestArch: "aarch64",
  kernelVersion: "6.12.20",
  checkpointToolVersion: "Version: 4.2",
  kernelFeatureProbeOutput: "Looks good.; seccomp_suspend is supported",
};

describe("guest checkpoint substrate summaries", () => {
  it("records a completed same-guest C checkpoint/restore row", () => {
    const row = buildGuestCheckpointSubstrateRow({
      ...base,
      profile: "c-simple",
      checkpointLog: "criu dump completed for pid=761 pre=8",
      restoreLog: "criu restore completed for pid=761",
      verifierOutput: "pre=8 post=16 restored pid=761 tail counter=15",
      evidence: { preProgress: 8, postRestoreProgress: 16, restoredPid: 761 },
    });
    expect(row).toMatchObject({
      kind: "machinen.architecture-portable-snapshot.guest-checkpoint-substrate",
      profile: "c-simple",
      state: "completed",
      scope: {
        sameGuest: true,
        sameIsa: true,
        crossIsaCheckpointReplay: false,
        sourceIsaEmulationUsed: false,
      },
    });
  });

  it("records a stable JVM refusal without claiming migration", () => {
    const row = buildGuestCheckpointSubstrateRow({
      ...base,
      profile: "jvm-simple",
      checkpointLog: "not-run: java not present in base guest",
      restoreLog: "not-run: java not present in base guest",
      verifierOutput: "java command not found",
      state: "refused",
      refusalCode: "jvm-runtime-unavailable",
      remediation: "Install a supported JVM in the guest, then run the JVM checkpoint profile.",
    });
    expect(row).toMatchObject({
      profile: "jvm-simple",
      state: "refused",
      refusalCode: "jvm-runtime-unavailable",
    });
  });

  it("validates completed and refused profile rows", () => {
    const summary = summarizeGuestCheckpointSubstrateRows([
      buildGuestCheckpointSubstrateRow({
        ...base,
        profile: "c-simple",
        checkpointLog: "dump ok",
        restoreLog: "restore ok",
        verifierOutput: "pre=8 post=16",
        evidence: { preCheckpointProgress: 8, postRestoreProgress: 16 },
      }),
      buildGuestCheckpointSubstrateRow({
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
