import { describe, expect, it } from "vitest";

import {
  cleanServiceManifestSchema,
  normalizeCleanServiceRefusalCode,
  selectRestorableCleanServiceComponent,
  validateCleanServiceManifest,
  versionsArePatchCompatible,
  type CleanServiceManifest,
} from "../clean-service/manifest.ts";

const digest = "a".repeat(64);

function manifest(componentOverrides: Record<string, unknown> = {}): CleanServiceManifest {
  return {
    kind: "machinen.clean-service-snapshot",
    formatVersion: 1,
    sourceArch: "arm64",
    snapshotEngine: "vmstate",
    routePolicy: "target-native-clean-service-when-target-arch-differs",
    observableStateDecisions: [
      {
        name: "service-process",
        decision: "recreated",
        rationale: "target-native service process is recreated",
      },
    ],
    components: [
      {
        id: "nodejs:primary-http-service",
        runtime: "node",
        subset: "node-http-clean-root-v1",
        sourceCwd: "/opt/app",
        argv: ["node", "server.js"],
        runtimeVersion: "v24.11.1",
        kernelResources: {
          decisionModel: "supported-irrelevant-refused",
          supported: ["clean-service-app-root-fd-captured"],
          irrelevant: ["clean-service-stdio-fd-irrelevant"],
          refused: [],
          summary: { supported: 1, irrelevant: 1, refused: 0 },
        },
        runtimePolicy: {
          compatibility: "exact-major-minor-patch-compatible",
          provisioning: "distro-package-set",
          packageSet: { distro: "debian", packages: ["nodejs", "curl"] },
          remediation: "Install a target Node runtime with the same major.minor release.",
        },
        guestPort: 3000,
        verifier: { kind: "http-get", path: "/", sha256: digest, bytes: 2 },
        artifact: { path: "clean-service-node-primary.tar.gz", sha256: digest, bytes: 10 },
        provenance: {},
        refusals: [],
        ...componentOverrides,
      },
    ],
    security: {
      sourceIsaEmulationUsed: false,
      sourceTextReplayAcceptedAsRestore: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      metadataOnlyContinuation: false,
    },
  };
}

describe("clean-service manifest schema", () => {
  it("publishes a machine-readable JSON schema for portable-clean-service.json", () => {
    expect(cleanServiceManifestSchema.$id).toContain("portable-clean-service-v1.json");
    expect(
      cleanServiceManifestSchema.properties.components.items.properties.subset["x-knownSubsets"],
    ).toContain("go-http-clean-root-v1");
    expect(
      cleanServiceManifestSchema.properties.observableStateDecisions.items.properties.decision.enum,
    ).toContain("logically-restored");
  });

  it("accepts current manifests with forward-compatible unknown properties", () => {
    const current = { ...manifest(), futureField: { preserved: true } };
    expect(validateCleanServiceManifest(current)).toEqual([]);
  });

  it("keeps backward compatibility with manifests captured before runtimePolicy existed", () => {
    const older = manifest();
    delete older.components[0]!.runtimePolicy;
    expect(validateCleanServiceManifest(older)).toEqual([]);
  });

  it("refuses unknown components through the product restore selector", () => {
    const unknown = manifest({ runtime: "ruby", subset: "ruby-http-clean-root-v1" });
    expect(validateCleanServiceManifest(unknown)).toEqual([]);
    const selected = selectRestorableCleanServiceComponent(unknown);
    expect(selected.ok).toBe(false);
    expect(selected.code).toBe("clean-service-required-component-unsupported");
  });
});

describe("clean-service component selection", () => {
  it("accepts exactly one supported component even when another component is unsupported", () => {
    const mixed = manifest();
    mixed.components.push({
      ...mixed.components[0]!,
      id: "future:unsupported",
      runtime: "future" as never,
      subset: "future-clean-root-v1" as never,
    });
    const selected = selectRestorableCleanServiceComponent(mixed);
    expect(selected.ok).toBe(true);
    expect(selected.component?.id).toBe("nodejs:primary-http-service");
  });

  it("refuses multiple unsupported components when no supported clean-service component exists", () => {
    const multiUnsupported = manifest({ runtime: "ruby", subset: "ruby-http-clean-root-v1" });
    multiUnsupported.components.push({
      ...multiUnsupported.components[0]!,
      id: "future:unsupported",
      runtime: "future" as never,
      subset: "future-clean-root-v1" as never,
    });
    const selected = selectRestorableCleanServiceComponent(multiUnsupported);
    expect(selected.ok).toBe(false);
    expect(selected.code).toBe("clean-service-required-component-unsupported");
  });

  it("refuses multiple supported components until explicit process groups exist", () => {
    const multi = manifest();
    multi.components.push({ ...multi.components[0]!, id: "nodejs:second-http-service" });
    const selected = selectRestorableCleanServiceComponent(multi);
    expect(selected.ok).toBe(false);
    expect(selected.code).toBe("clean-service-process-group-unsupported");
  });
});

describe("clean-service runtime policy and refusal vocabulary", () => {
  it("uses exact major/minor and patch-compatible target runtime matching", () => {
    expect(versionsArePatchCompatible("Python 3.11.2", "Python 3.11.8")).toBe(true);
    expect(versionsArePatchCompatible("v24.11.1", "v24.11.0")).toBe(true);
    expect(versionsArePatchCompatible("Python 3.11.2", "Python 3.12.0")).toBe(false);
  });

  it("normalizes runtime-specific active session refusals", () => {
    expect(normalizeCleanServiceRefusalCode("python-active-tcp-session-unsupported")).toBe(
      "clean-service-active-session-unsupported",
    );
    expect(normalizeCleanServiceRefusalCode("node-active-tcp-session-unsupported")).toBe(
      "clean-service-active-session-unsupported",
    );
    expect(normalizeCleanServiceRefusalCode("python-deleted-open-file-unsupported")).toBe(
      "clean-service-deleted-open-file-unsupported",
    );
    expect(normalizeCleanServiceRefusalCode("go-dynamic-binary-unsupported")).toBe(
      "clean-service-native-extension-state-unsupported",
    );
  });
});
