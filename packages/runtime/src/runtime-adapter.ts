const RUNTIME_ADAPTER_FORMAT_VERSION = 1;
const RUNTIME_ADAPTER_PROTOCOL_VERSION = 1;

export const RUNTIME_ADAPTER_BUNDLE_FILE = "runtime-adapter.json";

const RUNTIME_ADAPTER_ARCHES = ["arm64", "amd64"] as const;
const RUNTIME_ADAPTER_RUNTIME_NAMES = ["node", "bun", "custom"] as const;
const RUNTIME_ADAPTER_TRANSPORTS = ["stdio-json", "sidecar-json"] as const;
const RUNTIME_ADAPTER_VALUE_KINDS = [
  "undefined",
  "null",
  "boolean",
  "number",
  "bigint",
  "string",
  "bytes",
  "ref",
  "array",
] as const;
const RUNTIME_ADAPTER_OBJECT_KINDS = [
  "object",
  "array",
  "map",
  "set",
  "date",
  "regexp",
  "error",
  "array-buffer",
  "typed-array",
  "opaque",
] as const;
const RUNTIME_ADAPTER_RESOURCE_KINDS = [
  "argv",
  "env",
  "cwd",
  "fd",
  "file",
  "socket",
  "timer",
  "signal",
  "child-process",
  "worker",
  "pty",
  "fs-watch",
  "native-handle",
  "unknown",
] as const;
const RUNTIME_ADAPTER_RESOURCE_STATES = ["captured", "refused", "unsupported"] as const;
const RUNTIME_ADAPTER_MODULE_KINDS = [
  "builtin",
  "workspace",
  "relative",
  "external",
  "artifact",
] as const;
const RUNTIME_ADAPTER_MAPPING_ROLES = [
  "runtime-roots",
  "runtime-object-graph",
  "runtime-resources",
  "runtime-metadata",
] as const;

export const runtimeAdapterRefusalCodes = [
  "architecture-pair-unsupported",
  "architecture-unsupported",
  "fd-kind-unsupported",
  "feature-unsupported",
  "object-unsupported",
  "resource-unsupported",
  "runtime-adapter-missing",
  "runtime-heap-unsupported",
  "target-build-mismatch",
] as const;

export type RuntimeAdapterArch = "arm64" | "amd64";
export type RuntimeAdapterRuntimeName = "node" | "bun" | "custom";
export type RuntimeAdapterTransport = "stdio-json" | "sidecar-json";
export type RuntimeAdapterValueKind =
  | "undefined"
  | "null"
  | "boolean"
  | "number"
  | "bigint"
  | "string"
  | "bytes"
  | "ref"
  | "array";
export type RuntimeAdapterObjectKind =
  | "object"
  | "array"
  | "map"
  | "set"
  | "date"
  | "regexp"
  | "error"
  | "array-buffer"
  | "typed-array"
  | "opaque";
export type RuntimeAdapterResourceKind =
  | "argv"
  | "env"
  | "cwd"
  | "fd"
  | "file"
  | "socket"
  | "timer"
  | "signal"
  | "child-process"
  | "worker"
  | "pty"
  | "fs-watch"
  | "native-handle"
  | "unknown";
export type RuntimeAdapterResourceState = "captured" | "refused" | "unsupported";
export type RuntimeAdapterModuleKind =
  | "builtin"
  | "workspace"
  | "relative"
  | "external"
  | "artifact";
export type RuntimeAdapterMappingRole =
  | "runtime-roots"
  | "runtime-object-graph"
  | "runtime-resources"
  | "runtime-metadata";
export type RuntimeAdapterRefusalCode = (typeof runtimeAdapterRefusalCodes)[number];

export interface RuntimeAdapterRefusal {
  code: RuntimeAdapterRefusalCode;
  message: string;
  detail?: Record<string, unknown>;
}

export interface RuntimeAdapterUnsupportedVocabulary {
  vocabularyVersion: 1;
  refusals: RuntimeAdapterRefusal[];
}

export interface RuntimeAdapterEntrypoint {
  command: string;
  args: string[];
  transport: RuntimeAdapterTransport;
  env?: Record<string, string>;
}

export interface RuntimeAdapterEntrypoints {
  capture: RuntimeAdapterEntrypoint;
  restore: RuntimeAdapterEntrypoint;
}

export interface RuntimeAdapterDescriptor {
  id: string;
  protocolVersion: 1;
  runtime: RuntimeAdapterRuntimeName;
  name: string;
  version?: string;
  features: string[];
  entrypoints: RuntimeAdapterEntrypoints;
}

export interface RuntimeAdapterTarget {
  id: string;
  name: string;
  executable: string;
  sourceGuestArch: RuntimeAdapterArch;
  allowedTargetGuestArchs: RuntimeAdapterArch[];
}

export interface RuntimeAdapterSerializerCompatibility {
  semanticGraph: {
    supported: true;
    format: "machinen-runtime-adapter-v1";
  };
  rawHeap: {
    supported: false;
    refusal: RuntimeAdapterRefusal;
  };
  v8Serialize?: {
    supported: boolean;
    versionBound: boolean;
    portable: false;
    api?: string;
  };
  structuredClone?: {
    supported: boolean;
    persistentFormat: false;
  };
  heapSnapshot?: {
    inspected: boolean;
    restoreSupported: false;
    finding?: string;
  };
}

export interface RuntimeAdapterRuntime {
  name: RuntimeAdapterRuntimeName;
  version: string;
  engine?: {
    name: string;
    version: string;
  };
  serializerCompatibility: RuntimeAdapterSerializerCompatibility;
}

export interface RuntimeAdapterBuildModule {
  specifier: string;
  kind: RuntimeAdapterModuleKind;
  sha256?: string;
}

export interface RuntimeAdapterBuildIdentity {
  sourceSha256?: string;
  packageSha256?: string;
  lockfileSha256?: string;
  moduleGraphSha256?: string;
  artifactSha256?: string;
}

export interface RuntimeAdapterBuild {
  identity: RuntimeAdapterBuildIdentity;
  modules: RuntimeAdapterBuildModule[];
}

export interface RuntimeAdapterProcess {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
}

export type RuntimeAdapterValue =
  | { kind: "undefined" }
  | { kind: "null" }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "bigint"; decimal: string }
  | { kind: "string"; value: string }
  | { kind: "bytes"; base64: string; byteLength: number }
  | { kind: "ref"; objectId: string }
  | { kind: "array"; items: RuntimeAdapterValue[] };

export interface RuntimeAdapterRoot {
  name: string;
  value: RuntimeAdapterValue;
}

export interface RuntimeAdapterMapEntry {
  key: RuntimeAdapterValue;
  value: RuntimeAdapterValue;
}

export interface RuntimeAdapterObjectNode {
  id: string;
  kind: RuntimeAdapterObjectKind;
  type?: string;
  prototype?: string;
  properties?: Record<string, RuntimeAdapterValue>;
  elements?: RuntimeAdapterValue[];
  entries?: RuntimeAdapterMapEntry[];
  byteLength?: number;
  refusal?: RuntimeAdapterRefusal;
}

export interface RuntimeAdapterIdentityAssertion {
  left: string;
  right: string;
  same: boolean;
}

export interface RuntimeAdapterGraph {
  roots: RuntimeAdapterRoot[];
  objects: RuntimeAdapterObjectNode[];
  identityAssertions?: RuntimeAdapterIdentityAssertion[];
  checksumHex?: string;
}

export interface RuntimeAdapterResourceRecipe {
  kind: string;
  detail?: Record<string, unknown>;
}

export interface RuntimeAdapterResource {
  id: string;
  kind: RuntimeAdapterResourceKind;
  state: RuntimeAdapterResourceState;
  recipe?: RuntimeAdapterResourceRecipe;
  refusal?: RuntimeAdapterRefusal;
}

export interface RuntimeAdapterResources {
  resources: RuntimeAdapterResource[];
  unsupported: RuntimeAdapterUnsupportedVocabulary;
}

export interface RuntimeAdapterRestoreContract {
  semanticStateSupported: boolean;
  liveProcessSupported: boolean;
  requiredMetadata: string[];
  refusal?: RuntimeAdapterRefusal;
}

export interface RuntimeAdapterBundleObjectMapping {
  portableObjectId: string;
  role: RuntimeAdapterMappingRole;
  graphObjectIds?: string[];
}

export interface RuntimeAdapterBundleResourceMapping {
  portableResourceId: string;
  runtimeResourceId: string;
}

export interface RuntimeAdapterBundleMapping {
  manifestFeatures: string[];
  sidecarFiles: string[];
  objects: RuntimeAdapterBundleObjectMapping[];
  resources: RuntimeAdapterBundleResourceMapping[];
}

export interface RuntimeAdapterDocument {
  formatVersion: 1;
  adapter: RuntimeAdapterDescriptor;
  target: RuntimeAdapterTarget;
  runtime: RuntimeAdapterRuntime;
  build: RuntimeAdapterBuild;
  process: RuntimeAdapterProcess;
  graph: RuntimeAdapterGraph;
  resources: RuntimeAdapterResources;
  restore: RuntimeAdapterRestoreContract;
  bundleMapping: RuntimeAdapterBundleMapping;
  unsupported: RuntimeAdapterUnsupportedVocabulary;
}

export type RuntimeAdapterJsonSchema = Record<string, unknown>;

const REFUSAL_SCHEMA: RuntimeAdapterJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: { enum: runtimeAdapterRefusalCodes },
    message: { type: "string", minLength: 1 },
    detail: { type: "object" },
  },
};

const UNSUPPORTED_SCHEMA: RuntimeAdapterJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["vocabularyVersion", "refusals"],
  properties: {
    vocabularyVersion: { const: 1 },
    refusals: { type: "array", items: REFUSAL_SCHEMA },
  },
};

const VALUE_SCHEMA: RuntimeAdapterJsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "undefined" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "null" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value"],
      properties: { kind: { const: "boolean" }, value: { type: "boolean" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value"],
      properties: { kind: { const: "number" }, value: { type: "number" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "decimal"],
      properties: { kind: { const: "bigint" }, decimal: { type: "string", pattern: "^-?[0-9]+$" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value"],
      properties: { kind: { const: "string" }, value: { type: "string" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "base64", "byteLength"],
      properties: {
        kind: { const: "bytes" },
        base64: { type: "string" },
        byteLength: { type: "integer", minimum: 0 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "objectId"],
      properties: { kind: { const: "ref" }, objectId: { type: "string", minLength: 1 } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "items"],
      properties: {
        kind: { const: "array" },
        items: { type: "array", items: { $ref: "#/$defs/value" } },
      },
    },
  ],
};

export const runtimeAdapterSchemas = {
  document: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://machinen.dev/schemas/runtime-adapter/document.schema.json",
    title: "Machinen runtime adapter document",
    type: "object",
    additionalProperties: false,
    required: [
      "formatVersion",
      "adapter",
      "target",
      "runtime",
      "build",
      "process",
      "graph",
      "resources",
      "restore",
      "bundleMapping",
      "unsupported",
    ],
    properties: {
      formatVersion: { const: RUNTIME_ADAPTER_FORMAT_VERSION },
      adapter: {
        type: "object",
        additionalProperties: false,
        required: ["id", "protocolVersion", "runtime", "name", "features", "entrypoints"],
        properties: {
          id: { type: "string", minLength: 1 },
          protocolVersion: { const: RUNTIME_ADAPTER_PROTOCOL_VERSION },
          runtime: { enum: RUNTIME_ADAPTER_RUNTIME_NAMES },
          name: { type: "string", minLength: 1 },
          version: { type: "string", minLength: 1 },
          features: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
          entrypoints: { $ref: "#/$defs/entrypoints" },
        },
      },
      target: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "executable", "sourceGuestArch", "allowedTargetGuestArchs"],
        properties: {
          id: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          executable: { type: "string", minLength: 1 },
          sourceGuestArch: { enum: RUNTIME_ADAPTER_ARCHES },
          allowedTargetGuestArchs: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { enum: RUNTIME_ADAPTER_ARCHES },
          },
        },
      },
      runtime: { $ref: "#/$defs/runtime" },
      build: { $ref: "#/$defs/build" },
      process: { $ref: "#/$defs/process" },
      graph: { $ref: "#/$defs/graph" },
      resources: { $ref: "#/$defs/resources" },
      restore: { $ref: "#/$defs/restore" },
      bundleMapping: { $ref: "#/$defs/bundleMapping" },
      unsupported: UNSUPPORTED_SCHEMA,
    },
    $defs: {
      refusal: REFUSAL_SCHEMA,
      unsupported: UNSUPPORTED_SCHEMA,
      value: VALUE_SCHEMA,
      entrypoint: {
        type: "object",
        additionalProperties: false,
        required: ["command", "args", "transport"],
        properties: {
          command: { type: "string", minLength: 1 },
          args: { type: "array", items: { type: "string" } },
          transport: { enum: RUNTIME_ADAPTER_TRANSPORTS },
          env: { type: "object", additionalProperties: { type: "string" } },
        },
      },
      entrypoints: {
        type: "object",
        additionalProperties: false,
        required: ["capture", "restore"],
        properties: {
          capture: { $ref: "#/$defs/entrypoint" },
          restore: { $ref: "#/$defs/entrypoint" },
        },
      },
      runtime: {
        type: "object",
        additionalProperties: false,
        required: ["name", "version", "serializerCompatibility"],
        properties: {
          name: { enum: RUNTIME_ADAPTER_RUNTIME_NAMES },
          version: { type: "string", minLength: 1 },
          engine: {
            type: "object",
            additionalProperties: false,
            required: ["name", "version"],
            properties: {
              name: { type: "string", minLength: 1 },
              version: { type: "string", minLength: 1 },
            },
          },
          serializerCompatibility: {
            type: "object",
            additionalProperties: false,
            required: ["semanticGraph", "rawHeap"],
            properties: {
              semanticGraph: {
                type: "object",
                additionalProperties: false,
                required: ["supported", "format"],
                properties: {
                  supported: { const: true },
                  format: { const: "machinen-runtime-adapter-v1" },
                },
              },
              rawHeap: {
                type: "object",
                additionalProperties: false,
                required: ["supported", "refusal"],
                properties: { supported: { const: false }, refusal: REFUSAL_SCHEMA },
              },
              v8Serialize: { type: "object" },
              structuredClone: { type: "object" },
              heapSnapshot: { type: "object" },
            },
          },
        },
      },
      build: {
        type: "object",
        additionalProperties: false,
        required: ["identity", "modules"],
        properties: {
          identity: {
            type: "object",
            additionalProperties: { type: "string", pattern: "^[0-9A-Fa-f]{64}$" },
          },
          modules: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["specifier", "kind"],
              properties: {
                specifier: { type: "string", minLength: 1 },
                kind: { enum: RUNTIME_ADAPTER_MODULE_KINDS },
                sha256: { type: "string", pattern: "^[0-9A-Fa-f]{64}$" },
              },
            },
          },
        },
      },
      process: {
        type: "object",
        additionalProperties: false,
        required: ["argv", "env", "cwd"],
        properties: {
          argv: { type: "array", minItems: 1, items: { type: "string" } },
          env: { type: "object", additionalProperties: { type: "string" } },
          cwd: { type: "string", pattern: "^/" },
        },
      },
      graph: {
        type: "object",
        additionalProperties: false,
        required: ["roots", "objects"],
        properties: {
          roots: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "value"],
              properties: {
                name: { type: "string", minLength: 1 },
                value: { $ref: "#/$defs/value" },
              },
            },
          },
          objects: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "kind"],
              properties: {
                id: { type: "string", minLength: 1 },
                kind: { enum: RUNTIME_ADAPTER_OBJECT_KINDS },
                type: { type: "string", minLength: 1 },
                prototype: { type: "string", minLength: 1 },
                properties: { type: "object", additionalProperties: { $ref: "#/$defs/value" } },
                elements: { type: "array", items: { $ref: "#/$defs/value" } },
                entries: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["key", "value"],
                    properties: {
                      key: { $ref: "#/$defs/value" },
                      value: { $ref: "#/$defs/value" },
                    },
                  },
                },
                byteLength: { type: "integer", minimum: 0 },
                refusal: REFUSAL_SCHEMA,
              },
            },
          },
          identityAssertions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["left", "right", "same"],
              properties: {
                left: { type: "string", minLength: 1 },
                right: { type: "string", minLength: 1 },
                same: { type: "boolean" },
              },
            },
          },
          checksumHex: { type: "string", pattern: "^0x[0-9A-Fa-f]+$" },
        },
      },
      resources: {
        type: "object",
        additionalProperties: false,
        required: ["resources", "unsupported"],
        properties: {
          resources: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "kind", "state"],
              properties: {
                id: { type: "string", minLength: 1 },
                kind: { enum: RUNTIME_ADAPTER_RESOURCE_KINDS },
                state: { enum: RUNTIME_ADAPTER_RESOURCE_STATES },
                recipe: { type: "object" },
                refusal: REFUSAL_SCHEMA,
              },
            },
          },
          unsupported: UNSUPPORTED_SCHEMA,
        },
      },
      restore: {
        type: "object",
        additionalProperties: false,
        required: ["semanticStateSupported", "liveProcessSupported", "requiredMetadata"],
        properties: {
          semanticStateSupported: { type: "boolean" },
          liveProcessSupported: { type: "boolean" },
          requiredMetadata: { type: "array", items: { type: "string", minLength: 1 } },
          refusal: REFUSAL_SCHEMA,
        },
      },
      bundleMapping: {
        type: "object",
        additionalProperties: false,
        required: ["manifestFeatures", "sidecarFiles", "objects", "resources"],
        properties: {
          manifestFeatures: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
          },
          sidecarFiles: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
          },
          objects: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["portableObjectId", "role"],
              properties: {
                portableObjectId: { type: "string", minLength: 1 },
                role: { enum: RUNTIME_ADAPTER_MAPPING_ROLES },
                graphObjectIds: {
                  type: "array",
                  items: { type: "string", minLength: 1 },
                  uniqueItems: true,
                },
              },
            },
          },
          resources: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["portableResourceId", "runtimeResourceId"],
              properties: {
                portableResourceId: { type: "string", minLength: 1 },
                runtimeResourceId: { type: "string", minLength: 1 },
              },
            },
          },
        },
      },
    },
  },
} as const;

interface ValidationContext {
  errors: string[];
}

export class RuntimeAdapterValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(["runtime adapter validation failed:", ...errors.map((e) => `  - ${e}`)].join("\n"));
    this.name = "RuntimeAdapterValidationError";
    this.errors = errors;
  }
}

export function validateRuntimeAdapterDocument(document: unknown): string[] {
  const ctx: ValidationContext = { errors: [] };
  validateDocument(ctx, document);
  return ctx.errors;
}

export function assertRuntimeAdapterDocument(document: unknown): RuntimeAdapterDocument {
  const errors = validateRuntimeAdapterDocument(document);
  if (errors.length > 0) {
    throw new RuntimeAdapterValidationError(errors);
  }
  return document as RuntimeAdapterDocument;
}

function validateDocument(ctx: ValidationContext, value: unknown): void {
  const doc = expectRecord(ctx, "runtimeAdapter", value);
  if (!doc) {
    return;
  }
  if (doc.formatVersion !== RUNTIME_ADAPTER_FORMAT_VERSION) {
    ctx.errors.push(`runtimeAdapter.formatVersion must be ${RUNTIME_ADAPTER_FORMAT_VERSION}`);
  }
  validateAdapter(ctx, doc.adapter);
  validateTarget(ctx, doc.target);
  validateRuntime(ctx, doc.runtime);
  validateBuild(ctx, doc.build);
  validateProcess(ctx, doc.process);
  const objectIds = validateGraph(ctx, doc.graph);
  validateResources(ctx, doc.resources);
  validateRestore(ctx, doc.restore);
  validateBundleMapping(ctx, doc.bundleMapping, objectIds, resourceIds(doc.resources));
  validateUnsupported(ctx, "runtimeAdapter.unsupported", doc.unsupported);
}

function validateAdapter(ctx: ValidationContext, value: unknown): void {
  const adapter = expectRecord(ctx, "runtimeAdapter.adapter", value);
  if (!adapter) {
    return;
  }
  validateNonEmptyString(ctx, "runtimeAdapter.adapter.id", adapter.id);
  if (adapter.protocolVersion !== RUNTIME_ADAPTER_PROTOCOL_VERSION) {
    ctx.errors.push(
      `runtimeAdapter.adapter.protocolVersion must be ${RUNTIME_ADAPTER_PROTOCOL_VERSION}`,
    );
  }
  validateEnum(
    ctx,
    "runtimeAdapter.adapter.runtime",
    adapter.runtime,
    RUNTIME_ADAPTER_RUNTIME_NAMES,
  );
  validateNonEmptyString(ctx, "runtimeAdapter.adapter.name", adapter.name);
  if (adapter.version !== undefined) {
    validateNonEmptyString(ctx, "runtimeAdapter.adapter.version", adapter.version);
  }
  validateStringArray(ctx, "runtimeAdapter.adapter.features", adapter.features, { unique: true });
  validateEntrypoints(ctx, adapter.entrypoints);
}

function validateEntrypoints(ctx: ValidationContext, value: unknown): void {
  const entrypoints = expectRecord(ctx, "runtimeAdapter.adapter.entrypoints", value);
  if (!entrypoints) {
    return;
  }
  validateEntrypoint(ctx, "runtimeAdapter.adapter.entrypoints.capture", entrypoints.capture);
  validateEntrypoint(ctx, "runtimeAdapter.adapter.entrypoints.restore", entrypoints.restore);
}

function validateEntrypoint(ctx: ValidationContext, path: string, value: unknown): void {
  const entrypoint = expectRecord(ctx, path, value);
  if (!entrypoint) {
    return;
  }
  validateNonEmptyString(ctx, `${path}.command`, entrypoint.command);
  validateStringArray(ctx, `${path}.args`, entrypoint.args);
  validateEnum(ctx, `${path}.transport`, entrypoint.transport, RUNTIME_ADAPTER_TRANSPORTS);
  if (entrypoint.env !== undefined) {
    validateStringRecord(ctx, `${path}.env`, entrypoint.env);
  }
}

function validateTarget(ctx: ValidationContext, value: unknown): void {
  const target = expectRecord(ctx, "runtimeAdapter.target", value);
  if (!target) {
    return;
  }
  validateNonEmptyString(ctx, "runtimeAdapter.target.id", target.id);
  validateNonEmptyString(ctx, "runtimeAdapter.target.name", target.name);
  validateNonEmptyString(ctx, "runtimeAdapter.target.executable", target.executable);
  validateEnum(
    ctx,
    "runtimeAdapter.target.sourceGuestArch",
    target.sourceGuestArch,
    RUNTIME_ADAPTER_ARCHES,
  );
  validateStringArray(
    ctx,
    "runtimeAdapter.target.allowedTargetGuestArchs",
    target.allowedTargetGuestArchs,
    {
      minItems: 1,
      unique: true,
      allowed: RUNTIME_ADAPTER_ARCHES,
    },
  );
}

function validateRuntime(ctx: ValidationContext, value: unknown): void {
  const runtime = expectRecord(ctx, "runtimeAdapter.runtime", value);
  if (!runtime) {
    return;
  }
  validateEnum(ctx, "runtimeAdapter.runtime.name", runtime.name, RUNTIME_ADAPTER_RUNTIME_NAMES);
  validateNonEmptyString(ctx, "runtimeAdapter.runtime.version", runtime.version);
  validateOptionalEngine(ctx, runtime.engine);
  validateSerializerCompatibility(ctx, runtime.serializerCompatibility);
}

function validateOptionalEngine(ctx: ValidationContext, value: unknown): void {
  if (value === undefined) {
    return;
  }
  const engine = expectRecord(ctx, "runtimeAdapter.runtime.engine", value);
  if (!engine) {
    return;
  }
  validateNonEmptyString(ctx, "runtimeAdapter.runtime.engine.name", engine.name);
  validateNonEmptyString(ctx, "runtimeAdapter.runtime.engine.version", engine.version);
}

function validateSerializerCompatibility(ctx: ValidationContext, value: unknown): void {
  const serializer = expectRecord(ctx, "runtimeAdapter.runtime.serializerCompatibility", value);
  if (!serializer) {
    return;
  }
  validateSemanticGraph(ctx, serializer.semanticGraph);
  validateRawHeap(ctx, serializer.rawHeap);
  validateOptionalV8Serialize(ctx, serializer.v8Serialize);
  validateOptionalStructuredClone(ctx, serializer.structuredClone);
  validateOptionalHeapSnapshot(ctx, serializer.heapSnapshot);
}

function validateSemanticGraph(ctx: ValidationContext, value: unknown): void {
  const semanticGraph = expectRecord(
    ctx,
    "runtimeAdapter.runtime.serializerCompatibility.semanticGraph",
    value,
  );
  if (!semanticGraph) {
    return;
  }
  if (semanticGraph.supported !== true) {
    ctx.errors.push(
      "runtimeAdapter.runtime.serializerCompatibility.semanticGraph.supported must be true",
    );
  }
  if (semanticGraph.format !== "machinen-runtime-adapter-v1") {
    ctx.errors.push(
      "runtimeAdapter.runtime.serializerCompatibility.semanticGraph.format must be machinen-runtime-adapter-v1",
    );
  }
}

function validateRawHeap(ctx: ValidationContext, value: unknown): void {
  const rawHeap = expectRecord(
    ctx,
    "runtimeAdapter.runtime.serializerCompatibility.rawHeap",
    value,
  );
  if (!rawHeap) {
    return;
  }
  if (rawHeap.supported !== false) {
    ctx.errors.push(
      "runtimeAdapter.runtime.serializerCompatibility.rawHeap.supported must be false",
    );
  }
  validateRefusal(
    ctx,
    "runtimeAdapter.runtime.serializerCompatibility.rawHeap.refusal",
    rawHeap.refusal,
  );
}

function validateOptionalV8Serialize(ctx: ValidationContext, value: unknown): void {
  if (value === undefined) {
    return;
  }
  const v8 = expectRecord(ctx, "runtimeAdapter.runtime.serializerCompatibility.v8Serialize", value);
  if (!v8) {
    return;
  }
  validateBoolean(
    ctx,
    "runtimeAdapter.runtime.serializerCompatibility.v8Serialize.supported",
    v8.supported,
  );
  validateBoolean(
    ctx,
    "runtimeAdapter.runtime.serializerCompatibility.v8Serialize.versionBound",
    v8.versionBound,
  );
  if (v8.portable !== false) {
    ctx.errors.push(
      "runtimeAdapter.runtime.serializerCompatibility.v8Serialize.portable must be false",
    );
  }
  if (v8.api !== undefined) {
    validateNonEmptyString(
      ctx,
      "runtimeAdapter.runtime.serializerCompatibility.v8Serialize.api",
      v8.api,
    );
  }
}

function validateOptionalStructuredClone(ctx: ValidationContext, value: unknown): void {
  if (value === undefined) {
    return;
  }
  const clone = expectRecord(
    ctx,
    "runtimeAdapter.runtime.serializerCompatibility.structuredClone",
    value,
  );
  if (!clone) {
    return;
  }
  validateBoolean(
    ctx,
    "runtimeAdapter.runtime.serializerCompatibility.structuredClone.supported",
    clone.supported,
  );
  if (clone.persistentFormat !== false) {
    ctx.errors.push(
      "runtimeAdapter.runtime.serializerCompatibility.structuredClone.persistentFormat must be false",
    );
  }
}

function validateOptionalHeapSnapshot(ctx: ValidationContext, value: unknown): void {
  if (value === undefined) {
    return;
  }
  const heap = expectRecord(
    ctx,
    "runtimeAdapter.runtime.serializerCompatibility.heapSnapshot",
    value,
  );
  if (!heap) {
    return;
  }
  validateBoolean(
    ctx,
    "runtimeAdapter.runtime.serializerCompatibility.heapSnapshot.inspected",
    heap.inspected,
  );
  if (heap.restoreSupported !== false) {
    ctx.errors.push(
      "runtimeAdapter.runtime.serializerCompatibility.heapSnapshot.restoreSupported must be false",
    );
  }
  if (heap.finding !== undefined) {
    validateNonEmptyString(
      ctx,
      "runtimeAdapter.runtime.serializerCompatibility.heapSnapshot.finding",
      heap.finding,
    );
  }
}

function validateBuild(ctx: ValidationContext, value: unknown): void {
  const build = expectRecord(ctx, "runtimeAdapter.build", value);
  if (!build) {
    return;
  }
  validateBuildIdentity(ctx, build.identity);
  const modules = expectArray(ctx, "runtimeAdapter.build.modules", build.modules);
  if (!modules) {
    return;
  }
  for (let i = 0; i < modules.length; i++) {
    validateBuildModule(ctx, `runtimeAdapter.build.modules[${i}]`, modules[i]);
  }
}

function validateBuildIdentity(ctx: ValidationContext, value: unknown): void {
  const identity = expectRecord(ctx, "runtimeAdapter.build.identity", value);
  if (!identity) {
    return;
  }
  for (const key of [
    "sourceSha256",
    "packageSha256",
    "lockfileSha256",
    "moduleGraphSha256",
    "artifactSha256",
  ]) {
    const digest = identity[key];
    if (digest !== undefined) {
      validateSha256(ctx, `runtimeAdapter.build.identity.${key}`, digest);
    }
  }
}

function validateBuildModule(ctx: ValidationContext, path: string, value: unknown): void {
  const module = expectRecord(ctx, path, value);
  if (!module) {
    return;
  }
  validateNonEmptyString(ctx, `${path}.specifier`, module.specifier);
  validateEnum(ctx, `${path}.kind`, module.kind, RUNTIME_ADAPTER_MODULE_KINDS);
  if (module.sha256 !== undefined) {
    validateSha256(ctx, `${path}.sha256`, module.sha256);
  }
}

function validateProcess(ctx: ValidationContext, value: unknown): void {
  const process = expectRecord(ctx, "runtimeAdapter.process", value);
  if (!process) {
    return;
  }
  validateStringArray(ctx, "runtimeAdapter.process.argv", process.argv, { minItems: 1 });
  validateStringRecord(ctx, "runtimeAdapter.process.env", process.env);
  validateAbsolutePath(ctx, "runtimeAdapter.process.cwd", process.cwd);
}

function validateGraph(ctx: ValidationContext, value: unknown): Set<string> {
  const graph = expectRecord(ctx, "runtimeAdapter.graph", value);
  if (!graph) {
    return new Set();
  }
  const objectIds = validateObjectNodes(ctx, graph.objects);
  validateRoots(ctx, graph.roots, objectIds);
  validateIdentityAssertions(ctx, graph.identityAssertions);
  if (graph.checksumHex !== undefined) {
    validateHex(ctx, "runtimeAdapter.graph.checksumHex", graph.checksumHex);
  }
  return objectIds;
}

function validateRoots(ctx: ValidationContext, value: unknown, objectIds: Set<string>): void {
  const roots = expectArray(ctx, "runtimeAdapter.graph.roots", value);
  if (!roots) {
    return;
  }
  for (let i = 0; i < roots.length; i++) {
    const path = `runtimeAdapter.graph.roots[${i}]`;
    const root = expectRecord(ctx, path, roots[i]);
    if (!root) {
      continue;
    }
    validateNonEmptyString(ctx, `${path}.name`, root.name);
    validateValue(ctx, `${path}.value`, root.value, objectIds);
  }
}

function validateObjectNodes(ctx: ValidationContext, value: unknown): Set<string> {
  const objects = expectArray(ctx, "runtimeAdapter.graph.objects", value);
  if (!objects) {
    return new Set();
  }
  const objectIds = collectObjectIds(ctx, objects);
  for (let i = 0; i < objects.length; i++) {
    validateObjectNode(ctx, `runtimeAdapter.graph.objects[${i}]`, objects[i], objectIds);
  }
  return objectIds;
}

function collectObjectIds(ctx: ValidationContext, objects: unknown[]): Set<string> {
  const objectIds = new Set<string>();
  for (let i = 0; i < objects.length; i++) {
    const node = expectRecord(ctx, `runtimeAdapter.graph.objects[${i}]`, objects[i]);
    if (!node) {
      continue;
    }
    validateNonEmptyString(ctx, `runtimeAdapter.graph.objects[${i}].id`, node.id);
    if (typeof node.id !== "string") {
      continue;
    }
    if (objectIds.has(node.id)) {
      ctx.errors.push(
        `runtimeAdapter.graph.objects[${i}].id duplicates object id ${JSON.stringify(node.id)}`,
      );
    }
    objectIds.add(node.id);
  }
  return objectIds;
}

function validateObjectNode(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  objectIds: Set<string>,
): void {
  const node = expectRecord(ctx, path, value);
  if (!node) {
    return;
  }
  validateEnum(ctx, `${path}.kind`, node.kind, RUNTIME_ADAPTER_OBJECT_KINDS);
  if (node.type !== undefined) {
    validateNonEmptyString(ctx, `${path}.type`, node.type);
  }
  if (node.prototype !== undefined) {
    validateNonEmptyString(ctx, `${path}.prototype`, node.prototype);
  }
  validateOptionalProperties(ctx, `${path}.properties`, node.properties, objectIds);
  validateOptionalValues(ctx, `${path}.elements`, node.elements, objectIds);
  validateOptionalMapEntries(ctx, `${path}.entries`, node.entries, objectIds);
  if (node.byteLength !== undefined) {
    validateNonNegativeInteger(ctx, `${path}.byteLength`, node.byteLength);
  }
  if (node.refusal !== undefined) {
    validateRefusal(ctx, `${path}.refusal`, node.refusal);
  }
}

function validateOptionalProperties(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  objectIds: Set<string>,
): void {
  if (value === undefined) {
    return;
  }
  const properties = expectRecord(ctx, path, value);
  if (!properties) {
    return;
  }
  for (const [name, propertyValue] of Object.entries(properties)) {
    validateValue(ctx, `${path}.${name}`, propertyValue, objectIds);
  }
}

function validateOptionalValues(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  objectIds: Set<string>,
): void {
  if (value === undefined) {
    return;
  }
  const values = expectArray(ctx, path, value);
  if (!values) {
    return;
  }
  for (let i = 0; i < values.length; i++) {
    validateValue(ctx, `${path}[${i}]`, values[i], objectIds);
  }
}

function validateOptionalMapEntries(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  objectIds: Set<string>,
): void {
  if (value === undefined) {
    return;
  }
  const entries = expectArray(ctx, path, value);
  if (!entries) {
    return;
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = expectRecord(ctx, `${path}[${i}]`, entries[i]);
    if (!entry) {
      continue;
    }
    validateValue(ctx, `${path}[${i}].key`, entry.key, objectIds);
    validateValue(ctx, `${path}[${i}].value`, entry.value, objectIds);
  }
}

// fallow-ignore-next-line complexity
function validateValue(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  objectIds: Set<string>,
): void {
  const val = expectRecord(ctx, path, value);
  if (!val) {
    return;
  }
  validateEnum(ctx, `${path}.kind`, val.kind, RUNTIME_ADAPTER_VALUE_KINDS);
  switch (val.kind) {
    case "undefined":
    case "null":
      return;
    case "boolean":
      validateBoolean(ctx, `${path}.value`, val.value);
      return;
    case "number":
      validateNumber(ctx, `${path}.value`, val.value);
      return;
    case "bigint":
      validateBigIntDecimal(ctx, `${path}.decimal`, val.decimal);
      return;
    case "string":
      validateString(ctx, `${path}.value`, val.value);
      return;
    case "bytes":
      validateString(ctx, `${path}.base64`, val.base64);
      validateNonNegativeInteger(ctx, `${path}.byteLength`, val.byteLength);
      return;
    case "ref":
      validateObjectRef(ctx, `${path}.objectId`, val.objectId, objectIds);
      return;
    case "array":
      validateArrayValue(ctx, path, val.items, objectIds);
      return;
    default:
      return;
  }
}

function validateArrayValue(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  objectIds: Set<string>,
): void {
  const items = expectArray(ctx, `${path}.items`, value);
  if (!items) {
    return;
  }
  for (let i = 0; i < items.length; i++) {
    validateValue(ctx, `${path}.items[${i}]`, items[i], objectIds);
  }
}

function validateIdentityAssertions(ctx: ValidationContext, value: unknown): void {
  if (value === undefined) {
    return;
  }
  const assertions = expectArray(ctx, "runtimeAdapter.graph.identityAssertions", value);
  if (!assertions) {
    return;
  }
  for (let i = 0; i < assertions.length; i++) {
    const path = `runtimeAdapter.graph.identityAssertions[${i}]`;
    const assertion = expectRecord(ctx, path, assertions[i]);
    if (!assertion) {
      continue;
    }
    validateNonEmptyString(ctx, `${path}.left`, assertion.left);
    validateNonEmptyString(ctx, `${path}.right`, assertion.right);
    validateBoolean(ctx, `${path}.same`, assertion.same);
  }
}

function validateResources(ctx: ValidationContext, value: unknown): void {
  const resourcesDoc = expectRecord(ctx, "runtimeAdapter.resources", value);
  if (!resourcesDoc) {
    return;
  }
  const resources = expectArray(ctx, "runtimeAdapter.resources.resources", resourcesDoc.resources);
  if (resources) {
    for (let i = 0; i < resources.length; i++) {
      validateResource(ctx, `runtimeAdapter.resources.resources[${i}]`, resources[i]);
    }
  }
  validateUnsupported(ctx, "runtimeAdapter.resources.unsupported", resourcesDoc.unsupported);
}

function validateResource(ctx: ValidationContext, path: string, value: unknown): void {
  const resource = expectRecord(ctx, path, value);
  if (!resource) {
    return;
  }
  validateNonEmptyString(ctx, `${path}.id`, resource.id);
  validateEnum(ctx, `${path}.kind`, resource.kind, RUNTIME_ADAPTER_RESOURCE_KINDS);
  validateEnum(ctx, `${path}.state`, resource.state, RUNTIME_ADAPTER_RESOURCE_STATES);
  if (resource.recipe !== undefined) {
    validateResourceRecipe(ctx, `${path}.recipe`, resource.recipe);
  }
  if (resource.refusal !== undefined) {
    validateRefusal(ctx, `${path}.refusal`, resource.refusal);
  }
  if (
    (resource.state === "refused" || resource.state === "unsupported") &&
    resource.refusal === undefined
  ) {
    ctx.errors.push(`${path}.refusal is required when state is ${resource.state}`);
  }
}

function validateResourceRecipe(ctx: ValidationContext, path: string, value: unknown): void {
  const recipe = expectRecord(ctx, path, value);
  if (!recipe) {
    return;
  }
  validateNonEmptyString(ctx, `${path}.kind`, recipe.kind);
  if (recipe.detail !== undefined && !isRecord(recipe.detail)) {
    ctx.errors.push(`${path}.detail must be an object`);
  }
}

function validateRestore(ctx: ValidationContext, value: unknown): void {
  const restore = expectRecord(ctx, "runtimeAdapter.restore", value);
  if (!restore) {
    return;
  }
  validateBoolean(
    ctx,
    "runtimeAdapter.restore.semanticStateSupported",
    restore.semanticStateSupported,
  );
  validateBoolean(ctx, "runtimeAdapter.restore.liveProcessSupported", restore.liveProcessSupported);
  validateStringArray(ctx, "runtimeAdapter.restore.requiredMetadata", restore.requiredMetadata);
  if (restore.refusal !== undefined) {
    validateRefusal(ctx, "runtimeAdapter.restore.refusal", restore.refusal);
  }
  if (restore.liveProcessSupported === false && restore.refusal === undefined) {
    ctx.errors.push(
      "runtimeAdapter.restore.refusal is required when liveProcessSupported is false",
    );
  }
}

function validateBundleMapping(
  ctx: ValidationContext,
  value: unknown,
  objectIds: Set<string>,
  runtimeResourceIds: Set<string>,
): void {
  const mapping = expectRecord(ctx, "runtimeAdapter.bundleMapping", value);
  if (!mapping) {
    return;
  }
  validateStringArray(
    ctx,
    "runtimeAdapter.bundleMapping.manifestFeatures",
    mapping.manifestFeatures,
    {
      unique: true,
    },
  );
  validateStringArray(ctx, "runtimeAdapter.bundleMapping.sidecarFiles", mapping.sidecarFiles, {
    unique: true,
  });
  validateBundleObjectMappings(ctx, mapping.objects, objectIds);
  validateBundleResourceMappings(ctx, mapping.resources, runtimeResourceIds);
}

function validateBundleObjectMappings(
  ctx: ValidationContext,
  value: unknown,
  objectIds: Set<string>,
): void {
  const mappings = expectArray(ctx, "runtimeAdapter.bundleMapping.objects", value);
  if (!mappings) {
    return;
  }
  for (let i = 0; i < mappings.length; i++) {
    const path = `runtimeAdapter.bundleMapping.objects[${i}]`;
    const mapping = expectRecord(ctx, path, mappings[i]);
    if (!mapping) {
      continue;
    }
    validateNonEmptyString(ctx, `${path}.portableObjectId`, mapping.portableObjectId);
    validateEnum(ctx, `${path}.role`, mapping.role, RUNTIME_ADAPTER_MAPPING_ROLES);
    const graphObjectIds = validateStringArray(
      ctx,
      `${path}.graphObjectIds`,
      mapping.graphObjectIds,
      {
        unique: true,
        optional: true,
      },
    );
    if (graphObjectIds) {
      for (const id of graphObjectIds) {
        if (!objectIds.has(id)) {
          ctx.errors.push(`${path}.graphObjectIds references unknown object ${JSON.stringify(id)}`);
        }
      }
    }
  }
}

function validateBundleResourceMappings(
  ctx: ValidationContext,
  value: unknown,
  runtimeResourceIds: Set<string>,
): void {
  const mappings = expectArray(ctx, "runtimeAdapter.bundleMapping.resources", value);
  if (!mappings) {
    return;
  }
  for (let i = 0; i < mappings.length; i++) {
    const path = `runtimeAdapter.bundleMapping.resources[${i}]`;
    const mapping = expectRecord(ctx, path, mappings[i]);
    if (!mapping) {
      continue;
    }
    validateNonEmptyString(ctx, `${path}.portableResourceId`, mapping.portableResourceId);
    validateNonEmptyString(ctx, `${path}.runtimeResourceId`, mapping.runtimeResourceId);
    if (
      typeof mapping.runtimeResourceId === "string" &&
      !runtimeResourceIds.has(mapping.runtimeResourceId)
    ) {
      ctx.errors.push(
        `${path}.runtimeResourceId references unknown resource ${JSON.stringify(mapping.runtimeResourceId)}`,
      );
    }
  }
}

function resourceIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  if (!isRecord(value) || !Array.isArray(value.resources)) {
    return ids;
  }
  for (const resource of value.resources) {
    if (isRecord(resource) && typeof resource.id === "string") {
      ids.add(resource.id);
    }
  }
  return ids;
}

function validateUnsupported(ctx: ValidationContext, path: string, value: unknown): void {
  const unsupported = expectRecord(ctx, path, value);
  if (!unsupported) {
    return;
  }
  if (unsupported.vocabularyVersion !== 1) {
    ctx.errors.push(`${path}.vocabularyVersion must be 1`);
  }
  const refusals = expectArray(ctx, `${path}.refusals`, unsupported.refusals);
  if (!refusals) {
    return;
  }
  for (let i = 0; i < refusals.length; i++) {
    validateRefusal(ctx, `${path}.refusals[${i}]`, refusals[i]);
  }
}

function validateRefusal(ctx: ValidationContext, path: string, value: unknown): void {
  const refusal = expectRecord(ctx, path, value);
  if (!refusal) {
    return;
  }
  validateEnum(ctx, `${path}.code`, refusal.code, runtimeAdapterRefusalCodes);
  validateNonEmptyString(ctx, `${path}.message`, refusal.message);
  if (refusal.detail !== undefined && !isRecord(refusal.detail)) {
    ctx.errors.push(`${path}.detail must be an object`);
  }
}

function validateObjectRef(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  objectIds: Set<string>,
): void {
  validateNonEmptyString(ctx, path, value);
  if (typeof value === "string" && !objectIds.has(value)) {
    ctx.errors.push(`${path} references unknown object ${JSON.stringify(value)}`);
  }
}

// fallow-ignore-next-line complexity
function validateStringArray(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  opts: {
    minItems?: number;
    unique?: boolean;
    allowed?: readonly string[];
    optional?: boolean;
  } = {},
): string[] | undefined {
  if (value === undefined && opts.optional) {
    return undefined;
  }
  const array = expectArray(ctx, path, value);
  if (!array) {
    return undefined;
  }
  if (opts.minItems !== undefined && array.length < opts.minItems) {
    ctx.errors.push(`${path} must contain at least ${opts.minItems} item(s)`);
  }
  const seen = new Set<string>();
  const strings: string[] = [];
  for (let i = 0; i < array.length; i++) {
    const item = array[i];
    if (typeof item !== "string") {
      ctx.errors.push(`${path}[${i}] must be a string`);
      continue;
    }
    strings.push(item);
    if (opts.allowed && !opts.allowed.includes(item)) {
      ctx.errors.push(`${path}[${i}] must be one of: ${opts.allowed.join(", ")}`);
    }
    if (opts.unique) {
      if (seen.has(item)) {
        ctx.errors.push(`${path} duplicates ${JSON.stringify(item)}`);
      }
      seen.add(item);
    }
  }
  return strings;
}

function validateStringRecord(ctx: ValidationContext, path: string, value: unknown): void {
  const record = expectRecord(ctx, path, value);
  if (!record) {
    return;
  }
  for (const [key, entryValue] of Object.entries(record)) {
    if (typeof entryValue !== "string") {
      ctx.errors.push(`${path}.${key} must be a string`);
    }
  }
}

function validateEnum(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  allowed: readonly string[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    ctx.errors.push(`${path} must be one of: ${allowed.join(", ")}`);
  }
}

function validateAbsolutePath(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || !value.startsWith("/")) {
    ctx.errors.push(`${path} must be an absolute path`);
  }
}

function validateSha256(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    ctx.errors.push(`${path} must be a SHA-256 hex digest`);
  }
}

function validateHex(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || !HEX_RE.test(value)) {
    ctx.errors.push(`${path} must be a hex string`);
  }
}

function validateBigIntDecimal(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || !BIGINT_DECIMAL_RE.test(value)) {
    ctx.errors.push(`${path} must be a decimal bigint string`);
  }
}

function validateBoolean(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "boolean") {
    ctx.errors.push(`${path} must be a boolean`);
  }
}

function validateNumber(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    ctx.errors.push(`${path} must be a finite number`);
  }
}

function validateString(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string") {
    ctx.errors.push(`${path} must be a string`);
  }
}

function validateNonEmptyString(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || value.length === 0) {
    ctx.errors.push(`${path} must be a non-empty string`);
  }
}

function validateNonNegativeInteger(ctx: ValidationContext, path: string, value: unknown): void {
  if (!Number.isInteger(value) || Number(value) < 0) {
    ctx.errors.push(`${path} must be a non-negative integer`);
  }
}

function expectArray(ctx: ValidationContext, path: string, value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) {
    ctx.errors.push(`${path} must be an array`);
    return undefined;
  }
  return value;
}

function expectRecord(
  ctx: ValidationContext,
  path: string,
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    ctx.errors.push(`${path} must be an object`);
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SHA256_RE = /^[0-9A-Fa-f]{64}$/;
const HEX_RE = /^0x[0-9A-Fa-f]+$/;
const BIGINT_DECIMAL_RE = /^-?[0-9]+$/;
