import { describe, expect, it } from "vitest";
import {
  buildArchitecturePortableSnapshotGauntletRow,
  requiredArchitecturePortableSnapshotClaimIds,
  summarizeArchitecturePortableSnapshotGauntletRows,
  validateArchitecturePortableSnapshotGauntletInvariants,
} from "../architecture-portable-snapshot-gauntlet.ts";

function row(claimId: string, overrides = {}) {
  return buildArchitecturePortableSnapshotGauntletRow({
    claimId,
    claimName: claimId,
    evidenceStatus: "proof",
    sourceArch: "arm64",
    targetArch: "amd64",
    hostArch: "arm64",
    providerMode: "fixture",
    targetExecution: "native",
    evidenceCategory: "native/process-proof",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    stateModel: "logical",
    stateDecisions: ["target-verifier-passed", "product-support-not-claimed"],
    verifierCommand: "fixture",
    verifierOutput: "ok",
    artifactDigests: { fixture: "sha256:abc" },
    provenance: { fixture: true },
    migrationCompleted: false,
    ...overrides,
  });
}

describe("architecture-portable snapshot gauntlet", () => {
  it("accepts one checked row per required claim", () => {
    const rows = requiredArchitecturePortableSnapshotClaimIds.map((id) => row(id));
    const summary = summarizeArchitecturePortableSnapshotGauntletRows(rows);
    expect(summary.pass).toBe(true);
    expect(summary.rowCount).toBe(requiredArchitecturePortableSnapshotClaimIds.length);
  });

  it("fails when a required claim is absent", () => {
    const summary = summarizeArchitecturePortableSnapshotGauntletRows([
      row("opposite-isa-vm-execution"),
    ]);
    expect(summary.pass).toBe(false);
    expect(summary.failures).toContain("missing final gauntlet claim guest-checkpoint-c-simple");
  });

  it("rejects support emulation and raw source checkpoint replay", () => {
    const failures = validateArchitecturePortableSnapshotGauntletInvariants([
      row("bad-product", {
        evidenceStatus: "support",
        productSupport: "supported",
        evidenceCategory: "supported-semantic-continuation",
        targetExecution: "emulated",
        stateDecisions: [
          "raw-cross-isa-checkpoint-image-replay",
          "sidecar-output-used",
          "metadata-only-success",
        ],
      }),
    ]);
    expect(failures).toContain("bad-product supported row is not target-native");
    expect(failures).toContain(
      "bad-product reports raw source checkpoint image replay as product success",
    );
    expect(failures).toContain("bad-product reports sidecar success as workload restore success");
    expect(failures).toContain(
      "bad-product reports metadata-only continuation as product restore success",
    );
  });

  it("rejects support evidence without supported product support", () => {
    const failures = validateArchitecturePortableSnapshotGauntletInvariants([
      row("bad-product-status", {
        evidenceStatus: "support",
        evidenceCategory: "supported-semantic-restart",
      }),
    ]);
    expect(failures).toContain("bad-product-status supported row is not productSupport=supported");
  });

  it("rejects refusal rows that report completed migration", () => {
    const failures = validateArchitecturePortableSnapshotGauntletInvariants([
      row("bad-refusal", {
        evidenceStatus: "refusal",
        evidenceCategory: "unsupported",
        productSupport: "unsupported",
        migrationCompleted: true,
        refusalCode: "fixture-refusal",
        remediation: "fix fixture",
      }),
    ]);
    expect(failures).toContain("bad-refusal refusal row has migrationCompleted=true");
  });

  it("enforces the actual continuation proof contract for completed rows", () => {
    const failures = validateArchitecturePortableSnapshotGauntletInvariants([
      row("controlled-c-translated-continuation", {
        sourceArch: "arm64",
        targetArch: "arm64",
        targetExecution: "emulated",
        stateModel: "translated-controlled-continuation",
        stateDecisions: [
          "architecture-portable-state-bundle",
          "sidecar-runtime-used",
          "source-isa-emulation-used",
          "raw-cross-isa-checkpoint-image-replay",
        ],
        verifierOutput: "metadata-only success",
        artifactDigests: { manifest: "sha256:manifest" },
        provenance: { mode: "fixture" },
        migrationCompleted: true,
      }),
    ]);
    expect(failures).toEqual(
      expect.arrayContaining([
        "controlled-c-translated-continuation completed continuation is not opposite-ISA",
        "controlled-c-translated-continuation completed continuation is not target-native",
        "controlled-c-translated-continuation completed continuation lacks target verifier marker",
        "controlled-c-translated-continuation completed continuation lacks live target provenance",
        "controlled-c-translated-continuation completed continuation missing targetEnv digest",
        "controlled-c-translated-continuation reports sidecar success as continuation success",
        "controlled-c-translated-continuation reports source-ISA emulation as continuation success",
        "controlled-c-translated-continuation reports raw checkpoint replay as continuation success",
      ]),
    );
  });
});
