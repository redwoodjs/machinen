import { describe, expect, it } from "vitest";

import {
  buildAdvancedLinuxFacilityProbeRow,
  summarizeAdvancedLinuxFacilityProbeRows,
} from "../advanced-linux-facility-probe.ts";

const base = {
  sourceArch: "arm64",
  targetArch: "arm64",
  kernelVersion: "6.12.20",
};

describe("advanced Linux facility probe summaries", () => {
  it("accepts a seccomp proof-only row", () => {
    expect(
      buildAdvancedLinuxFacilityProbeRow({
        ...base,
        facility: "seccomp",
        stateModel: "recreated",
        requiredCapabilities: [],
        verifierOutput: "seccomp deny-getppid filter returned EPERM before and after recreate",
        classification: "proof-only-feasibility",
      }),
    ).toMatchObject({
      kind: "machinen.cross-arch-criu.advanced-linux-facility-probe",
      facility: "seccomp",
      classification: "proof-only-feasibility",
      migrationCompleted: false,
    });
  });

  it("requires stable refusal details", () => {
    const summary = summarizeAdvancedLinuxFacilityProbeRows([
      buildAdvancedLinuxFacilityProbeRow({
        ...base,
        facility: "ebpf",
        stateModel: "refused",
        requiredCapabilities: ["CAP_BPF", "CAP_SYS_ADMIN"],
        verifierOutput: "unprivileged BPF disabled and no bpftool available",
        classification: "refused",
        refusalCode: "insufficient-privileges",
        remediation: "Run on a guest with CAP_BPF/CAP_SYS_ADMIN and a bounded BPF fixture.",
      }),
    ]);
    expect(summary.failures).toContain("missing facility seccomp");
    expect(summary.rows[0]).toMatchObject({ migrationCompleted: false });
  });

  it("summarizes a complete facility matrix", () => {
    const rows = [
      ["seccomp", "recreated", "proof-only-feasibility"],
      ["ebpf", "refused", "refused"],
      ["namespace", "recreated", "proof-only-feasibility"],
      ["cgroup", "recreated", "proof-only-feasibility"],
      ["capability", "proven-irrelevant", "proof-only-feasibility"],
    ].map(([facility, stateModel, classification]) =>
      buildAdvancedLinuxFacilityProbeRow({
        ...base,
        facility: facility as never,
        stateModel: stateModel as never,
        requiredCapabilities: [],
        verifierOutput: `${facility} verifier`,
        classification: classification as never,
        refusalCode: classification === "refused" ? "insufficient-privileges" : undefined,
        remediation: classification === "refused" ? "Add required privileges." : undefined,
      }),
    );
    expect(summarizeAdvancedLinuxFacilityProbeRows(rows)).toMatchObject({
      pass: true,
      rowCount: 5,
    });
  });
});
