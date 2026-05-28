import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildArchitecturePortableControlledContinuationBundle,
  buildArchitecturePortableControlledContinuationRow,
  sha256File,
  summarizeArchitecturePortableControlledContinuationRows,
  validateArchitecturePortableControlledContinuationBundle,
  validateArchitecturePortableControlledContinuationBundleShape,
  validateArchitecturePortableControlledContinuationRows,
  writeArchitecturePortableControlledContinuationBundle,
} from "../architecture-portable-controlled-continuation.ts";

function validBundleInput(targetBinarySha256 = "abc") {
  return {
    sourceArch: "arm64" as const,
    targetArch: "amd64" as const,
    capturedCounter: 41,
    continuationLabel: "safe-counter-v1",
    sourceVerifierOutput: "source-capture-ok capturedCounter=41",
    targetBinaryRelativePath: "target/controlled-counter-amd64",
    targetBinarySha256,
    targetBinaryProvenance: { compiler: "zig fixture", target: "x86_64-linux-musl" },
    verifierCommand: "loader bundle",
  };
}

describe("architecture-portable controlled continuation", () => {
  it("builds and validates a portable bundle with refusal inventory", () => {
    const dir = mkdtempSync(join(tmpdir(), "controlled-continuation-test-"));
    const targetDir = join(dir, "target");
    mkdirSync(targetDir, { recursive: true });
    const targetBinary = join(targetDir, "controlled-counter-amd64");
    writeFileSync(targetBinary, "binary fixture", { mode: 0o755 });
    const bundle = buildArchitecturePortableControlledContinuationBundle(
      validBundleInput(sha256File(targetBinary)),
    );
    writeArchitecturePortableControlledContinuationBundle(dir, bundle);

    expect(validateArchitecturePortableControlledContinuationBundle(dir)).toEqual([]);
    expect(bundle.manifest.stateModel).toBe("translated-controlled-continuation");
    expect(bundle.manifest.shortcuts.sourceIsaEmulationUsed).toBe(false);
    expect(bundle.unsupportedStates.map((state) => state.category)).toContain("socket");
  });

  it("rejects same-ISA bundles and forbidden shortcuts", () => {
    const bundle = buildArchitecturePortableControlledContinuationBundle({
      ...validBundleInput(),
      targetArch: "arm64",
    });
    bundle.manifest.shortcuts.sidecarRuntimeUsed = true as false;
    const failures = validateArchitecturePortableControlledContinuationBundleShape(bundle);
    expect(failures).toContain("sourceArch and targetArch must differ");
    expect(failures).toContain("manifest has forbidden shortcut enabled");
  });

  it("accepts a live target-native proof row with migrationCompleted=true", () => {
    const row = buildArchitecturePortableControlledContinuationRow({
      classification: "proof-only-feasibility",
      sourceArch: "arm64",
      targetArch: "amd64",
      hostArch: "arm64",
      providerMode: "ssh-real-target:root@192.168.0.8",
      targetExecution: "native",
      verifierCommand: "loader bundle",
      verifierOutput: "target-native-continuation-ok\nrestoredCounter=42",
      artifactDigests: { manifest: "sha256:manifest" },
      provenance: { mode: "live" },
      migrationCompleted: true,
    });

    expect(summarizeArchitecturePortableControlledContinuationRows([row])).toMatchObject({
      pass: true,
      rowCount: 1,
      failures: [],
    });
  });

  it("rejects completed rows without target-native verifier output", () => {
    const row = buildArchitecturePortableControlledContinuationRow({
      classification: "proof-only-feasibility",
      sourceArch: "arm64",
      targetArch: "amd64",
      hostArch: "arm64",
      providerMode: "fixture",
      targetExecution: "native",
      verifierCommand: "loader bundle",
      verifierOutput: "metadata-only success",
      artifactDigests: { manifest: "sha256:manifest" },
      provenance: { mode: "fixture" },
      migrationCompleted: true,
    });

    expect(validateArchitecturePortableControlledContinuationRows([row])).toContain(
      "completed controlled continuation lacks target verifier marker",
    );
  });

  it("requires refused rows to stay incomplete and carry remediation", () => {
    const row = buildArchitecturePortableControlledContinuationRow({
      classification: "refused",
      sourceArch: "arm64",
      targetArch: "amd64",
      hostArch: "arm64",
      providerMode: "negative-fixture",
      targetExecution: "not-applicable",
      verifierCommand: "fixture",
      verifierOutput: "sidecar output refused",
      artifactDigests: { fixture: "sidecar" },
      provenance: { mode: "negative" },
      migrationCompleted: true,
      refusalCode: "sidecar-output-refused",
    });

    expect(validateArchitecturePortableControlledContinuationRows([row])).toEqual([
      "refused/skipped controlled continuation cannot complete migration",
      "refused/skipped controlled continuation missing remediation",
    ]);
  });
});
