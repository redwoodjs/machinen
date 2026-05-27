type CleanServiceArch = "arm64" | "amd64";
type CleanServiceRuntime = "node" | "python" | "go";
type CleanServiceSubset =
  | "node-http-clean-root-v1"
  | "python-http-clean-root-v1"
  | "go-http-clean-root-v1";
type CleanServiceRuntimeCompatibility = "exact-major-minor-patch-compatible" | "none-static-binary";
type CleanServiceRuntimeProvisioning =
  | "runtime-preinstalled"
  | "distro-package-set"
  | "bundled-runtime-layer";

interface CleanServiceRuntimePolicy {
  compatibility: CleanServiceRuntimeCompatibility;
  provisioning: CleanServiceRuntimeProvisioning;
  packageSet?: {
    distro: "debian";
    packages: string[];
    digest?: string;
    provenance?: string;
  };
  bundledLayer?: {
    path: string;
    sha256: string;
    provenance: string;
  };
  remediation: string;
}

export interface CleanServiceManifest {
  kind: "machinen.clean-service-snapshot";
  formatVersion: 1;
  sourceArch: CleanServiceArch;
  snapshotEngine: "vmstate" | "criu" | "unknown";
  routePolicy: "target-native-clean-service-when-target-arch-differs";
  components: CleanServiceComponent[];
  security: {
    sourceIsaEmulationUsed: false;
    sourceTextReplayAcceptedAsRestore: false;
    sidecarRuntimeUsed: false;
    appHooksRequired: false;
    metadataOnlyContinuation: false;
  };
}

export interface CleanServiceComponent {
  id: string;
  runtime: CleanServiceRuntime;
  subset: CleanServiceSubset;
  sourceCwd: string;
  argv: string[];
  runtimeVersion: string;
  runtimePolicy?: CleanServiceRuntimePolicy;
  guestPort: number;
  verifier: { kind: "http-get"; path: "/"; sha256: string; bytes: number };
  artifact: { path: string; sha256: string; bytes: number };
  provenance: Record<string, unknown>;
  refusals: [];
}

export type CleanServiceCapture = CleanServiceManifest & {
  artifactBytesByPath: Record<string, Buffer>;
};

interface CleanServiceRefusal {
  code: string;
  message: string;
  runtimeCode?: string;
}

interface CleanServiceComponentSelection {
  ok: boolean;
  component?: CleanServiceComponent;
  code?: string;
  message?: string;
}

export const cleanServiceManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://machinen.dev/schemas/portable-clean-service-v1.json",
  title: "Machinen portable clean-service manifest",
  type: "object",
  required: [
    "kind",
    "formatVersion",
    "sourceArch",
    "snapshotEngine",
    "routePolicy",
    "components",
    "security",
  ],
  additionalProperties: true,
  properties: {
    kind: { const: "machinen.clean-service-snapshot" },
    formatVersion: { const: 1 },
    sourceArch: { enum: ["arm64", "amd64"] },
    snapshotEngine: { enum: ["vmstate", "criu", "unknown"] },
    routePolicy: { const: "target-native-clean-service-when-target-arch-differs" },
    components: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: [
          "id",
          "runtime",
          "subset",
          "sourceCwd",
          "argv",
          "runtimeVersion",
          "guestPort",
          "verifier",
          "artifact",
          "provenance",
          "refusals",
        ],
        additionalProperties: true,
        properties: {
          id: { type: "string", minLength: 1 },
          runtime: { enum: ["node", "python", "go"] },
          subset: {
            type: "string",
            "x-knownSubsets": [
              "node-http-clean-root-v1",
              "python-http-clean-root-v1",
              "go-http-clean-root-v1",
            ],
          },
          sourceCwd: { type: "string", minLength: 1 },
          argv: { type: "array", items: { type: "string" }, minItems: 1 },
          runtimeVersion: { type: "string" },
          runtimePolicy: {
            type: "object",
            required: ["compatibility", "provisioning", "remediation"],
            additionalProperties: true,
            properties: {
              compatibility: {
                enum: ["exact-major-minor-patch-compatible", "none-static-binary"],
              },
              provisioning: {
                enum: ["runtime-preinstalled", "distro-package-set", "bundled-runtime-layer"],
              },
              packageSet: { type: "object", additionalProperties: true },
              bundledLayer: { type: "object", additionalProperties: true },
              remediation: { type: "string" },
            },
          },
          guestPort: { type: "integer", minimum: 1, maximum: 65535 },
          verifier: {
            type: "object",
            required: ["kind", "path", "sha256", "bytes"],
            additionalProperties: true,
            properties: {
              kind: { const: "http-get" },
              path: { const: "/" },
              sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
              bytes: { type: "integer", minimum: 0 },
            },
          },
          artifact: {
            type: "object",
            required: ["path", "sha256", "bytes"],
            additionalProperties: true,
            properties: {
              path: { type: "string", minLength: 1 },
              sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
              bytes: { type: "integer", minimum: 0 },
            },
          },
          provenance: { type: "object", additionalProperties: true },
          refusals: { type: "array" },
        },
      },
    },
    security: {
      type: "object",
      required: [
        "sourceIsaEmulationUsed",
        "sourceTextReplayAcceptedAsRestore",
        "sidecarRuntimeUsed",
        "appHooksRequired",
        "metadataOnlyContinuation",
      ],
      additionalProperties: true,
      properties: {
        sourceIsaEmulationUsed: { const: false },
        sourceTextReplayAcceptedAsRestore: { const: false },
        sidecarRuntimeUsed: { const: false },
        appHooksRequired: { const: false },
        metadataOnlyContinuation: { const: false },
      },
    },
  },
} as const;

const requiredManifestFields = [
  "kind",
  "formatVersion",
  "sourceArch",
  "snapshotEngine",
  "routePolicy",
  "components",
  "security",
] as const;
const requiredComponentFields = [
  "id",
  "runtime",
  "subset",
  "sourceCwd",
  "argv",
  "runtimeVersion",
  "guestPort",
  "verifier",
  "artifact",
  "provenance",
  "refusals",
] as const;

export function validateCleanServiceManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["manifest must be an object"];
  }
  for (const field of requiredManifestFields) {
    if (!(field in value)) {
      errors.push(`missing required field: ${field}`);
    }
  }
  if (value.kind !== "machinen.clean-service-snapshot") {
    errors.push("kind must be machinen.clean-service-snapshot");
  }
  if (value.formatVersion !== 1) {
    errors.push("formatVersion must be 1");
  }
  if (value.sourceArch !== "arm64" && value.sourceArch !== "amd64") {
    errors.push("sourceArch must be arm64 or amd64");
  }
  if (!Array.isArray(value.components)) {
    errors.push("components must be an array");
  } else if (value.components.length === 0) {
    errors.push("components must not be empty");
  } else {
    // fallow-ignore-next-line complexity
    value.components.forEach((component, index) => {
      if (!isRecord(component)) {
        errors.push(`components[${index}] must be an object`);
        return;
      }
      for (const field of requiredComponentFields) {
        if (!(field in component)) {
          errors.push(`components[${index}] missing required field: ${field}`);
        }
      }
      if (typeof component.subset !== "string") {
        errors.push(`components[${index}] subset must be a string`);
      }
      if (!Array.isArray(component.argv) || component.argv.some((arg) => typeof arg !== "string")) {
        errors.push(`components[${index}] argv must be an array of strings`);
      }
      if (
        !isRecord(component.verifier) ||
        component.verifier.kind !== "http-get" ||
        component.verifier.path !== "/"
      ) {
        errors.push(`components[${index}] verifier must be http-get /`);
      }
      if (!isSha256(isRecord(component.verifier) ? component.verifier.sha256 : undefined)) {
        errors.push(`components[${index}] verifier.sha256 must be a lowercase sha256 hex digest`);
      }
      if (!isRecord(component.artifact) || typeof component.artifact.path !== "string") {
        errors.push(`components[${index}] artifact.path must be a string`);
      }
      if (!isSha256(isRecord(component.artifact) ? component.artifact.sha256 : undefined)) {
        errors.push(`components[${index}] artifact.sha256 must be a lowercase sha256 hex digest`);
      }
    });
  }
  return errors;
}

export function selectRestorableCleanServiceComponent(
  manifest: CleanServiceManifest,
): CleanServiceComponentSelection {
  const supported = manifest.components.filter(isSupportedCleanServiceComponent);
  if (supported.length === 1) {
    return { ok: true, component: supported[0] };
  }
  if (supported.length > 1) {
    return {
      ok: false,
      code: "clean-service-process-group-unsupported",
      message:
        "clean-service restore currently requires exactly one supported service component; explicit process groups are not implemented yet",
    };
  }
  return {
    ok: false,
    code: "clean-service-required-component-unsupported",
    message: "clean-service manifest has no supported restorable service component",
  };
}

function isSupportedCleanServiceComponent(component: CleanServiceComponent): boolean {
  return (
    (component.runtime === "node" && component.subset === "node-http-clean-root-v1") ||
    (component.runtime === "python" && component.subset === "python-http-clean-root-v1") ||
    (component.runtime === "go" && component.subset === "go-http-clean-root-v1")
  );
}

export function cleanServiceSecurityAssertions(): CleanServiceManifest["security"] {
  return {
    sourceIsaEmulationUsed: false,
    sourceTextReplayAcceptedAsRestore: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
    metadataOnlyContinuation: false,
  };
}

export function runtimePolicyFor(runtime: CleanServiceRuntime): CleanServiceRuntimePolicy {
  if (runtime === "node") {
    return {
      compatibility: "exact-major-minor-patch-compatible",
      provisioning: "distro-package-set",
      packageSet: {
        distro: "debian",
        packages: ["nodejs", "curl", "ca-certificates"],
        provenance: "Debian target image package repository at restore time",
      },
      remediation:
        "Install a target Node runtime with the same major.minor release as the source, or recapture with a supported target runtime policy.",
    };
  }
  if (runtime === "python") {
    return {
      compatibility: "exact-major-minor-patch-compatible",
      provisioning: "distro-package-set",
      packageSet: {
        distro: "debian",
        packages: [
          "python3.11",
          "python3.11-minimal",
          "libpython3.11-minimal",
          "libpython3.11-stdlib",
          "media-types",
          "curl",
          "ca-certificates",
        ],
        provenance: "Debian target image package repository at restore time",
      },
      remediation:
        "Install Python with the same major.minor release as the source, or provide a bundled runtime layer with digest and provenance.",
    };
  }
  return {
    compatibility: "none-static-binary",
    provisioning: "runtime-preinstalled",
    remediation:
      "Go clean-service restore only supports a statically linked application binary captured from the app root; rebuild with CGO_ENABLED=0 if refused.",
  };
}

export function normalizeCleanServiceRefusalCode(code: string): string {
  const aliases: Record<string, string> = {
    "node-active-tcp-session-unsupported": "clean-service-active-session-unsupported",
    "python-active-tcp-session-unsupported": "clean-service-active-session-unsupported",
    "go-active-tcp-session-unsupported": "clean-service-active-session-unsupported",
    "node-child-process-tree-unsupported": "clean-service-child-process-tree-unsupported",
    "python-child-process-tree-unsupported": "clean-service-child-process-tree-unsupported",
    "go-child-process-tree-unsupported": "clean-service-child-process-tree-unsupported",
    "node-target-verifier-missing": "clean-service-verifier-missing",
    "python-target-verifier-missing": "clean-service-verifier-missing",
    "go-target-verifier-missing": "clean-service-verifier-missing",
    "node-host-mounted-state-ambiguous": "clean-service-host-mounted-state-ambiguous",
    "python-host-mounted-state-ambiguous": "clean-service-host-mounted-state-ambiguous",
    "go-host-mounted-state-ambiguous": "clean-service-host-mounted-state-ambiguous",
    "node-native-addon-abi-state-unsupported": "clean-service-native-extension-state-unsupported",
    "python-native-extension-state-unsupported": "clean-service-native-extension-state-unsupported",
    "go-cgo-state-unsupported": "clean-service-native-extension-state-unsupported",
    "go-dynamic-binary-unsupported": "clean-service-native-extension-state-unsupported",
    "node-inspector-session-unsupported": "clean-service-runtime-private-state-unsupported",
    "python-thread-state-unsupported": "clean-service-runtime-private-state-unsupported",
    "go-executable-outside-root-unsupported": "clean-service-required-component-unsupported",
  };
  return aliases[code] ?? code;
}

export function normalizeCleanServiceRefusal(refusal: CleanServiceRefusal): CleanServiceRefusal {
  const generic = normalizeCleanServiceRefusalCode(refusal.code);
  return generic === refusal.code
    ? refusal
    : { ...refusal, code: generic, runtimeCode: refusal.code };
}

export function cleanServiceStableRefusalCodes(): string[] {
  return [
    "clean-service-active-session-unsupported",
    "clean-service-active-tcp-session-unsupported",
    "clean-service-tls-session-unsupported",
    "clean-service-child-process-tree-unsupported",
    "clean-service-verifier-missing",
    "clean-service-verifier-mismatch",
    "clean-service-artifact-digest-mismatch",
    "clean-service-target-architecture-mismatch",
    "clean-service-runtime-unavailable",
    "clean-service-runtime-identity-mismatch",
    "clean-service-runtime-policy-mismatch",
    "clean-service-host-mounted-state-ambiguous",
    "clean-service-dirty-persistent-state-unsupported",
    "clean-service-native-extension-state-unsupported",
    "clean-service-runtime-private-state-unsupported",
    "clean-service-package-provenance-mismatch",
    "clean-service-required-component-unsupported",
    "clean-service-process-group-unsupported",
  ];
}

export function versionsArePatchCompatible(sourceVersion: string, targetVersion: string): boolean {
  const source = parseMajorMinor(sourceVersion);
  const target = parseMajorMinor(targetVersion);
  return Boolean(
    source && target && source.major === target.major && source.minor === target.minor,
  );
}

export function runtimePolicyForComponent(
  component: CleanServiceComponent,
): CleanServiceRuntimePolicy {
  return component.runtimePolicy ?? runtimePolicyFor(component.runtime);
}

function parseMajorMinor(version: string): { major: number; minor: number } | undefined {
  const match = /(?:^|\s|v)(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
