/** Portable cross-ISA machine snapshot boundary metadata. */

export const PORTABLE_MACHINE_SNAPSHOT_FORMAT_VERSION = 1;

export const portableMachineSnapshotArchitectures = ["arm64", "amd64"] as const;
export type PortableMachineSnapshotArchitecture =
  (typeof portableMachineSnapshotArchitectures)[number];

export const portableMachineSnapshotRefusalCodes = [
  "cross-isa-vmstate-restore-unsupported",
  "raw-vcpu-state-unsupported",
  "raw-kernel-state-unsupported",
  "raw-device-state-unsupported",
  "target-isa-vm-restore-loader-missing",
  "portable-process-image-missing",
] as const;
export type PortableMachineSnapshotRefusalCode =
  (typeof portableMachineSnapshotRefusalCodes)[number];

export interface PortableMachineSnapshotRefusal {
  code: PortableMachineSnapshotRefusalCode;
  message: string;
  detail?: Record<string, unknown>;
}

export interface PortableMachineSnapshotRefusals {
  vocabularyVersion: 1;
  refusals: PortableMachineSnapshotRefusal[];
}

export interface PortableMachineSnapshotManifest {
  formatVersion: 1;
  kind: "machinen.portable-machine-snapshot";
  source: {
    guestArch: PortableMachineSnapshotArchitecture;
    vmstate: {
      rawRestore: "refused";
      refusalCode: "cross-isa-vmstate-restore-unsupported";
      reason: string;
    };
    kernelState: "not-translated";
    deviceState: "not-translated";
  };
  target: {
    guestArch: PortableMachineSnapshotArchitecture;
    mode: "target-isa-vm-process-restore";
    execution: "target-native";
  };
  payload: {
    nativeProcessImage: {
      kind: "machinen.native-process-image";
      path: string;
    };
    resourceModel: "explicit-recipes-only";
  };
  refusals: PortableMachineSnapshotRefusals;
}

export const portableMachineSnapshotManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://machinen.dev/schemas/portable-machine-snapshot/manifest.schema.json",
  title: "Machinen portable machine snapshot manifest",
  type: "object",
  additionalProperties: false,
  required: ["formatVersion", "kind", "source", "target", "payload", "refusals"],
  properties: {
    formatVersion: { const: PORTABLE_MACHINE_SNAPSHOT_FORMAT_VERSION },
    kind: { const: "machinen.portable-machine-snapshot" },
    source: {
      type: "object",
      additionalProperties: false,
      required: ["guestArch", "vmstate", "kernelState", "deviceState"],
      properties: {
        guestArch: { enum: portableMachineSnapshotArchitectures },
        vmstate: {
          type: "object",
          additionalProperties: false,
          required: ["rawRestore", "refusalCode", "reason"],
          properties: {
            rawRestore: { const: "refused" },
            refusalCode: { const: "cross-isa-vmstate-restore-unsupported" },
            reason: { type: "string", minLength: 1 },
          },
        },
        kernelState: { const: "not-translated" },
        deviceState: { const: "not-translated" },
      },
    },
    target: {
      type: "object",
      additionalProperties: false,
      required: ["guestArch", "mode", "execution"],
      properties: {
        guestArch: { enum: portableMachineSnapshotArchitectures },
        mode: { const: "target-isa-vm-process-restore" },
        execution: { const: "target-native" },
      },
    },
    payload: {
      type: "object",
      additionalProperties: false,
      required: ["nativeProcessImage", "resourceModel"],
      properties: {
        nativeProcessImage: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "path"],
          properties: {
            kind: { const: "machinen.native-process-image" },
            path: { type: "string", minLength: 1 },
          },
        },
        resourceModel: { const: "explicit-recipes-only" },
      },
    },
    refusals: {
      type: "object",
      additionalProperties: false,
      required: ["vocabularyVersion", "refusals"],
      properties: {
        vocabularyVersion: { const: 1 },
        refusals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["code", "message"],
            properties: {
              code: { enum: portableMachineSnapshotRefusalCodes },
              message: { type: "string", minLength: 1 },
              detail: { type: "object" },
            },
          },
        },
      },
    },
  },
} as const;

export class PortableMachineSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortableMachineSnapshotValidationError";
  }
}

export function crossIsaVmstateRestoreRefusal(
  sourceArch: string,
  targetArch: string,
): PortableMachineSnapshotRefusal {
  return {
    code: "cross-isa-vmstate-restore-unsupported",
    message: "raw whole-VM vmstate cannot be restored across guest ISAs",
    detail: {
      sourceArch,
      targetArch,
      requiredPath: "target-isa-vm-process-restore",
    },
  };
}

export function validatePortableMachineSnapshotManifest(
  input: unknown,
): PortableMachineSnapshotManifest {
  const manifest = requireRecord(input, "manifest");
  requireValue(manifest, "formatVersion", PORTABLE_MACHINE_SNAPSHOT_FORMAT_VERSION, "manifest");
  requireValue(manifest, "kind", "machinen.portable-machine-snapshot", "manifest");

  const source = validateSource(manifest.source);
  const target = validateTarget(manifest.target);
  if (source.guestArch === target.guestArch) {
    fail("manifest.target.guestArch must differ from manifest.source.guestArch");
  }

  return {
    formatVersion: PORTABLE_MACHINE_SNAPSHOT_FORMAT_VERSION,
    kind: "machinen.portable-machine-snapshot",
    source,
    target,
    payload: validatePayload(manifest.payload),
    refusals: validateRefusals(manifest.refusals),
  };
}

function validateSource(input: unknown): PortableMachineSnapshotManifest["source"] {
  const source = requireRecord(input, "manifest.source");
  const vmstate = requireRecord(source.vmstate, "manifest.source.vmstate");
  requireValue(vmstate, "rawRestore", "refused", "manifest.source.vmstate");
  requireValue(
    vmstate,
    "refusalCode",
    "cross-isa-vmstate-restore-unsupported",
    "manifest.source.vmstate",
  );
  requireValue(source, "kernelState", "not-translated", "manifest.source");
  requireValue(source, "deviceState", "not-translated", "manifest.source");
  return {
    guestArch: requireArch(source.guestArch, "manifest.source.guestArch"),
    vmstate: {
      rawRestore: "refused",
      refusalCode: "cross-isa-vmstate-restore-unsupported",
      reason: requireString(vmstate.reason, "manifest.source.vmstate.reason"),
    },
    kernelState: "not-translated",
    deviceState: "not-translated",
  };
}

function validateTarget(input: unknown): PortableMachineSnapshotManifest["target"] {
  const target = requireRecord(input, "manifest.target");
  requireValue(target, "mode", "target-isa-vm-process-restore", "manifest.target");
  requireValue(target, "execution", "target-native", "manifest.target");
  return {
    guestArch: requireArch(target.guestArch, "manifest.target.guestArch"),
    mode: "target-isa-vm-process-restore",
    execution: "target-native",
  };
}

function validatePayload(input: unknown): PortableMachineSnapshotManifest["payload"] {
  const payload = requireRecord(input, "manifest.payload");
  const nativeProcessImage = requireRecord(
    payload.nativeProcessImage,
    "manifest.payload.nativeProcessImage",
  );
  requireValue(
    nativeProcessImage,
    "kind",
    "machinen.native-process-image",
    "manifest.payload.nativeProcessImage",
  );
  requireValue(payload, "resourceModel", "explicit-recipes-only", "manifest.payload");
  return {
    nativeProcessImage: {
      kind: "machinen.native-process-image",
      path: requireString(nativeProcessImage.path, "manifest.payload.nativeProcessImage.path"),
    },
    resourceModel: "explicit-recipes-only",
  };
}

function validateRefusals(input: unknown): PortableMachineSnapshotRefusals {
  const refusals = requireRecord(input, "manifest.refusals");
  requireValue(refusals, "vocabularyVersion", 1, "manifest.refusals");
  if (!Array.isArray(refusals.refusals)) {
    fail("manifest.refusals.refusals must be an array");
  }
  return {
    vocabularyVersion: 1,
    refusals: refusals.refusals.map(validateRefusal),
  };
}

function validateRefusal(input: unknown): PortableMachineSnapshotRefusal {
  const refusal = requireRecord(input, "manifest.refusals.refusals[]");
  const code = requireRefusalCode(refusal.code);
  return {
    code,
    message: requireString(refusal.message, "manifest.refusals.refusals[].message"),
    detail:
      refusal.detail === undefined ? undefined : requireRecord(refusal.detail, "refusal.detail"),
  };
}

function requireRecord(input: unknown, path: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail(`${path} must be an object`);
  }
  return input as Record<string, unknown>;
}

function requireString(input: unknown, path: string): string {
  if (typeof input !== "string" || input.length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  return input;
}

function requireArch(input: unknown, path: string): PortableMachineSnapshotArchitecture {
  if (input === "arm64" || input === "amd64") {
    return input;
  }
  fail(`${path} must be one of: arm64, amd64`);
}

function requireRefusalCode(input: unknown): PortableMachineSnapshotRefusalCode {
  if (portableMachineSnapshotRefusalCodes.includes(input as PortableMachineSnapshotRefusalCode)) {
    return input as PortableMachineSnapshotRefusalCode;
  }
  fail(`refusal code is not in the portable machine snapshot vocabulary: ${String(input)}`);
}

function requireValue(
  record: Record<string, unknown>,
  key: string,
  expected: string | number,
  path: string,
): void {
  if (record[key] !== expected) {
    fail(`${path}.${key} must be ${JSON.stringify(expected)}`);
  }
}

function fail(message: string): never {
  throw new PortableMachineSnapshotValidationError(message);
}
