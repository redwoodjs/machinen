import { describe, expect, it } from "vitest";
import {
  buildFinalCrossArchCriuGauntletRow,
  requiredFinalCrossArchCriuClaimIds,
  summarizeFinalCrossArchCriuGauntletRows,
  validateFinalCrossArchCriuGauntletInvariants,
} from "../final-cross-arch-criu-gauntlet.ts";

function row(claimId: string, overrides = {}) {
  return buildFinalCrossArchCriuGauntletRow({
    claimId,
    claimName: claimId,
    classification: "proof-only-feasibility",
    sourceArch: "arm64",
    targetArch: "amd64",
    hostArch: "arm64",
    providerMode: "fixture",
    targetExecution: "native",
    stateModel: "logical",
    stateDecisions: ["target-verifier-passed"],
    verifierCommand: "fixture",
    verifierOutput: "ok",
    artifactDigests: { fixture: "sha256:abc" },
    provenance: { fixture: true },
    migrationCompleted: false,
    ...overrides,
  });
}

describe("final cross-arch CRIU gauntlet", () => {
  it("accepts one checked row per required claim", () => {
    const rows = requiredFinalCrossArchCriuClaimIds.map((id) => row(id));
    const summary = summarizeFinalCrossArchCriuGauntletRows(rows);
    expect(summary.pass).toBe(true);
    expect(summary.rowCount).toBe(requiredFinalCrossArchCriuClaimIds.length);
  });

  it("fails when a required claim is absent", () => {
    const summary = summarizeFinalCrossArchCriuGauntletRows([row("opposite-isa-vm-execution")]);
    expect(summary.pass).toBe(false);
    expect(summary.failures).toContain(
      "missing final gauntlet claim postgres-bidirectional-logical-restore",
    );
  });

  it("rejects product-supported emulation and raw cross-ISA CRIU replay", () => {
    const failures = validateFinalCrossArchCriuGauntletInvariants([
      row("bad-product", {
        classification: "product-supported",
        targetExecution: "emulated",
        stateDecisions: ["raw-cross-isa-criu-image-replay"],
      }),
    ]);
    expect(failures).toContain("bad-product product-supported row is not target-native");
    expect(failures).toContain(
      "bad-product reports raw cross-ISA CRIU image replay as product success",
    );
  });

  it("rejects refused rows that report completed migration", () => {
    const failures = validateFinalCrossArchCriuGauntletInvariants([
      row("bad-refusal", {
        classification: "refused",
        migrationCompleted: true,
        refusalCode: "fixture-refusal",
        remediation: "fix fixture",
      }),
    ]);
    expect(failures).toContain("bad-refusal refused row has migrationCompleted=true");
  });
});
