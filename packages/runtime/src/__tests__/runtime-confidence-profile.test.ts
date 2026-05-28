import { describe, expect, it } from "vitest";

import {
  buildRuntimeConfidenceProfileMatrix,
  buildRuntimeConfidenceProfileRow,
  runtimeConfidenceProfileFixtures,
  validateRuntimeConfidenceProfiles,
} from "../runtime-confidence-profile.ts";

describe("runtime confidence profile matrix", () => {
  it("contains every required C and Java profile in both architecture directions", () => {
    const rows = runtimeConfidenceProfileFixtures();
    for (const profile of [
      "c-static-binary",
      "c-dynamic-binary",
      "c-file-io",
      "c-timer",
      "c-signal",
      "c-tcp-listener",
      "java-loop-service",
    ]) {
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ profile, sourceArch: "arm64", targetArch: "amd64" }),
          expect.objectContaining({ profile, sourceArch: "amd64", targetArch: "arm64" }),
        ]),
      );
    }
  });

  it("classifies C profiles with explicit state dispositions", () => {
    const summary = buildRuntimeConfidenceProfileMatrix();
    expect(summary).toMatchObject({ pass: true, rowCount: 14 });
    expect(summary.rows.find((row) => row.profile === "c-static-binary")).toMatchObject({
      classification: "proof-only-feasibility",
      stateModel: "recreated",
      migrationCompleted: false,
    });
    expect(summary.rows.find((row) => row.profile === "c-file-io")).toMatchObject({
      classification: "proof-only-feasibility",
      stateModel: "logically-restored",
    });
    expect(summary.rows.find((row) => row.profile === "c-tcp-listener")).toMatchObject({
      classification: "refused",
      refusalCode: "active-sockets-unsupported",
    });
  });

  it("refuses Java without silently accepting JVM-private state", () => {
    const java = buildRuntimeConfidenceProfileMatrix().rows.find(
      (row) => row.profile === "java-loop-service",
    );
    expect(java).toMatchObject({
      runtime: "java",
      classification: "refused",
      stateModel: "refused",
      migrationCompleted: false,
      refusalCode: "missing-target-runtime-or-dynamic-library-provenance",
    });
    expect(java?.verifierOutput).toContain("JVM-private/JIT/thread state not modeled");
  });

  it("rejects refused rows without stable refusal details", () => {
    const invalid = buildRuntimeConfidenceProfileRow({
      runtime: "c",
      profile: "bad-tcp",
      classification: "refused",
      sourceArch: "arm64",
      targetArch: "amd64",
      stateModel: "refused",
      artifactDigests: { source: "abc" },
      runtimeVersion: "fixture",
      verifierOutput: "refused",
    });
    expect(validateRuntimeConfidenceProfiles([invalid])).toContain(
      "bad-tcp refusal missing migration=false, code, or remediation",
    );
  });
});
