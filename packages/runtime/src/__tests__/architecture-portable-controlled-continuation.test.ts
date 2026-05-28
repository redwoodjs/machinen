import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_BUNDLE_FILES,
  buildArchitecturePortableControlledContinuationBundle,
  buildArchitecturePortableControlledContinuationRow,
  controlledContinuationUnsupportedStateCategories,
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
    targetBinaryProvenance: {
      compiler: "zig fixture",
      target: "x86_64-linux-musl",
      sourceSha256: "source-sha-fixture",
      targetBinaryBytes: 14,
    },
    verifierCommand: "loader bundle",
  };
}

function verifierOutput(overrides: Record<string, string | number> = {}) {
  const values = {
    sourceArch: "arm64",
    targetArch: "amd64",
    capturedCounter: 41,
    restoredCounter: 42,
    continuationLabel: "safe-counter-v1",
    ...overrides,
  };
  return [
    "controlled-c-continuation",
    `sourceArch=${values.sourceArch}`,
    `targetArch=${values.targetArch}`,
    `capturedCounter=${values.capturedCounter}`,
    `restoredCounter=${values.restoredCounter}`,
    `continuationLabel=${values.continuationLabel}`,
    "target-native-continuation-ok",
  ].join("\n");
}

function completedRow(overrides = {}) {
  return buildArchitecturePortableControlledContinuationRow({
    classification: "proof-only-feasibility",
    sourceArch: "arm64",
    targetArch: "amd64",
    hostArch: "arm64",
    providerMode: "ssh-real-target:root@192.168.0.8",
    targetExecution: "native",
    verifierCommand: "loader bundle",
    verifierOutput: verifierOutput(),
    artifactDigests: {
      manifest: "sha256:manifest",
      state: "sha256:state",
      refusals: "sha256:refusals",
      targetEnv: "sha256:target-env",
      targetBinary: "sha256:target-binary",
    },
    provenance: { mode: "live" },
    migrationCompleted: true,
    ...overrides,
  });
}

function bundleDir() {
  const dir = mkdtempSync(join(tmpdir(), "controlled-continuation-test-"));
  const targetDir = join(dir, "target");
  mkdirSync(targetDir, { recursive: true });
  const targetBinary = join(targetDir, "controlled-counter-amd64");
  writeFileSync(targetBinary, "binary fixture", { mode: 0o755 });
  const bundle = buildArchitecturePortableControlledContinuationBundle(
    validBundleInput(sha256File(targetBinary)),
  );
  writeArchitecturePortableControlledContinuationBundle(dir, bundle);
  return { dir, targetBinary, bundle };
}

describe("architecture-portable controlled continuation", () => {
  it("builds and validates a portable bundle with refusal inventory and file digests", () => {
    const { dir, bundle } = bundleDir();
    try {
      expect(validateArchitecturePortableControlledContinuationBundle(dir)).toEqual([]);
      expect(bundle.manifest.stateModel).toBe("translated-controlled-continuation");
      expect(bundle.manifest.shortcuts.sourceIsaEmulationUsed).toBe(false);
      expect(bundle.unsupportedStates.map((state) => state.category)).toEqual(
        expect.arrayContaining([...controlledContinuationUnsupportedStateCategories]),
      );
      expect(
        bundle.unsupportedStates.every((state) => state.refusalCode === "unsupported-state"),
      ).toBe(true);
      expect(bundle.manifest.artifactDigests.targetEnv).toBe(sha256File(join(dir, "target.env")));
      expect(ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_BUNDLE_FILES).toContain("target.env");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects same-ISA bundles, forbidden shortcuts, and incomplete provenance", () => {
    const bundle = buildArchitecturePortableControlledContinuationBundle({
      ...validBundleInput(),
      targetArch: "arm64",
      targetBinaryProvenance: { compiler: "zig fixture" },
    });
    bundle.manifest.shortcuts.sidecarRuntimeUsed = true as false;
    const failures = validateArchitecturePortableControlledContinuationBundleShape(bundle);
    expect(failures).toContain("sourceArch and targetArch must differ");
    expect(failures).toContain("manifest has forbidden shortcut enabled");
    expect(failures).toContain("manifest target artifact provenance is incomplete");
  });

  it("rejects missing unsupported-state categories and missing remediation", () => {
    const bundle = buildArchitecturePortableControlledContinuationBundle({
      ...validBundleInput(),
      unsupportedStates: [
        {
          category: "file",
          decision: "refused",
          reason: "fixture",
          refusalCode: "unsupported-state",
          remediation: "fixture",
        },
        {
          category: "socket",
          decision: "refused",
          reason: "fixture",
          refusalCode: "unsupported-state",
          remediation: "",
        },
      ],
    });
    const failures = validateArchitecturePortableControlledContinuationBundleShape(bundle);
    expect(failures).toContain("unsupported state inventory missing thread");
    expect(failures).toContain("unsupported state socket is missing refusal code or remediation");
  });

  it("rejects tampered bundle files", () => {
    const { dir } = bundleDir();
    try {
      writeFileSync(join(dir, "target.env"), "SOURCE_ARCH='arm64'\n");
      expect(validateArchitecturePortableControlledContinuationBundle(dir)).toContain(
        "targetEnv digest mismatch",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a live target-native proof row with migrationCompleted=true", () => {
    expect(summarizeArchitecturePortableControlledContinuationRows([completedRow()])).toMatchObject(
      {
        pass: true,
        rowCount: 1,
        failures: [],
      },
    );
  });

  it("rejects completed rows without target-native verifier output", () => {
    const row = completedRow({
      providerMode: "fixture",
      verifierOutput: "metadata-only success",
      provenance: { mode: "fixture" },
    });

    expect(validateArchitecturePortableControlledContinuationRows([row])).toEqual(
      expect.arrayContaining([
        "completed controlled continuation lacks target verifier marker",
        "completed controlled continuation lacks captured/restored counter evidence",
        "completed controlled continuation must come from a live target proof",
      ]),
    );
  });

  it("rejects completed rows that are same-ISA, emulated, sidecar, metadata-only, or raw replay", () => {
    const row = completedRow({
      sourceArch: "amd64",
      targetExecution: "emulated",
    });
    row.scope.sidecarRuntimeUsed = true as false;
    row.scope.metadataOnlyContinuation = true as false;
    row.scope.rawCheckpointReplayClaimed = true as false;

    expect(validateArchitecturePortableControlledContinuationRows([row])).toEqual(
      expect.arrayContaining([
        "completed controlled continuation must be opposite-ISA",
        "completed controlled continuation must be target-native",
        "controlled continuation row overclaims restore scope",
        "controlled continuation row used a forbidden shortcut",
      ]),
    );
  });

  it("rejects completed rows when the target does not advance from captured state", () => {
    const row = completedRow({ verifierOutput: verifierOutput({ restoredCounter: 99 }) });
    expect(validateArchitecturePortableControlledContinuationRows([row])).toContain(
      "completed controlled continuation did not advance from captured state",
    );
  });

  it("rejects completed rows missing restore-affecting artifact digests", () => {
    const row = completedRow({ artifactDigests: { manifest: "sha256:manifest" } });
    expect(validateArchitecturePortableControlledContinuationRows([row])).toEqual(
      expect.arrayContaining([
        "completed controlled continuation missing state digest",
        "completed controlled continuation missing refusals digest",
        "completed controlled continuation missing targetEnv digest",
        "completed controlled continuation missing targetBinary digest",
      ]),
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

    expect(validateArchitecturePortableControlledContinuationRows([row])).toEqual(
      expect.arrayContaining([
        "refused/skipped controlled continuation cannot complete migration",
        "refused/skipped controlled continuation missing remediation",
      ]),
    );
  });
});
