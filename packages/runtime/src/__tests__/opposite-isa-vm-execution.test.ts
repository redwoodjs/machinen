import { describe, expect, it } from "vitest";

import {
  buildOppositeIsaVmExecutionSummary,
  classifyOppositeIsaProviderRoute,
  hostArchitectureFromNode,
  normalizeGuestMachine,
  oppositeGuestArchitecture,
} from "../opposite-isa-vm-execution.ts";

const completedEvidence = {
  hostArch: "arm64" as const,
  guestArch: "amd64" as const,
  providerMode: "test-explicit-emulation",
  accelerated: false,
  emulated: true,
  kernelVersion: "6.8.0-test",
  rootfsDigest: "a".repeat(64),
  guestUnameMachine: "x86_64",
  guestElfMachine: "ELF 64-bit LSB executable, x86-64",
  verifierOutput: "guest-verifier: uname=x86_64 elf=x86-64 marker=from-guest",
  verifierSource: "guest-exec" as const,
  routeAvailable: true,
};

describe("opposite-ISA VM execution summary", () => {
  it("normalizes host and guest architecture names", () => {
    expect(hostArchitectureFromNode("x64")).toBe("amd64");
    expect(hostArchitectureFromNode("arm64")).toBe("arm64");
    expect(oppositeGuestArchitecture("arm64")).toBe("amd64");
    expect(oppositeGuestArchitecture("amd64")).toBe("arm64");
    expect(normalizeGuestMachine("ELF 64-bit LSB executable, ARM aarch64")).toBe("arm64");
    expect(normalizeGuestMachine("ELF 64-bit LSB executable, x86-64")).toBe("amd64");
  });

  it("classifies provider route availability and labels acceleration/emulation", () => {
    expect(
      classifyOppositeIsaProviderRoute({
        hostArch: "arm64",
        guestArch: "amd64",
        platform: "darwin",
      }),
    ).toMatchObject({
      providerMode: "darwin-hvf-opposite-isa-unsupported",
      accelerated: false,
      emulated: false,
      available: false,
      unavailableReason: "opposite-isa-provider-unavailable",
    });
    expect(
      classifyOppositeIsaProviderRoute({
        hostArch: "arm64",
        guestArch: "amd64",
        platform: "linux",
        emulationAvailable: true,
      }),
    ).toMatchObject({
      providerMode: "linux-explicit-emulation",
      accelerated: false,
      emulated: true,
      available: true,
    });
  });

  it("completes when guest uname, guest ELF machine, and guest verifier agree", () => {
    expect(buildOppositeIsaVmExecutionSummary(completedEvidence)).toMatchObject({
      kind: "machinen.cross-arch-criu.opposite-isa-vm-execution",
      hostArch: "arm64",
      guestArch: "amd64",
      state: "completed",
      guestUnameMachine: "x86_64",
      guestElfMachine: "ELF 64-bit LSB executable, x86-64",
    });
  });

  it("skips with stable remediation when provider or assets are unavailable", () => {
    expect(
      buildOppositeIsaVmExecutionSummary({
        ...completedEvidence,
        routeAvailable: false,
        unavailableReason: "opposite-isa-provider-unavailable",
      }),
    ).toMatchObject({
      state: "skipped",
      refusalCode: "opposite-isa-provider-unavailable",
    });
    expect(
      buildOppositeIsaVmExecutionSummary({ ...completedEvidence, rootfsDigest: null }),
    ).toMatchObject({ state: "skipped", refusalCode: "opposite-isa-assets-missing" });
  });

  it("rejects host-side sidecar output and mismatched guest evidence", () => {
    expect(
      buildOppositeIsaVmExecutionSummary({
        ...completedEvidence,
        verifierSource: "host-sidecar",
      }),
    ).toMatchObject({ state: "refused", refusalCode: "opposite-isa-host-sidecar-output" });
    expect(
      buildOppositeIsaVmExecutionSummary({
        ...completedEvidence,
        guestUnameMachine: "aarch64",
      }),
    ).toMatchObject({ state: "refused", refusalCode: "opposite-isa-guest-uname-mismatch" });
    expect(
      buildOppositeIsaVmExecutionSummary({
        ...completedEvidence,
        guestElfMachine: "ELF 64-bit LSB executable, ARM aarch64",
      }),
    ).toMatchObject({ state: "refused", refusalCode: "opposite-isa-guest-elf-mismatch" });
  });
});
