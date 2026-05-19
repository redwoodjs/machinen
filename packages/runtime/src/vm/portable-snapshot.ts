import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const PORTABLE_SNAPSHOT_FORMAT_VERSION = 1;
const PORTABLE_CHECKPOINT_ABI_VERSION = 1;

const PORTABLE_CHECKPOINT_ABI = {
  checkpointFunction: "machinen_checkpoint",
  rootsType: "machinen_checkpoint_roots",
  restoreBundleType: "machinen_restore_bundle",
  safePoint: {
    outsideSignalHandlers: true,
    outsideSyscalls: true,
  },
} as const;

const PORTABLE_SNAPSHOT_FILES = {
  manifest: "manifest.json",
  memory: "memory.bin",
  objects: "objects.json",
  relocations: "relocations.json",
  resources: "resources.json",
  logs: "logs",
} as const;

const PORTABLE_GUEST_ARCHES = ["arm64", "amd64"] as const;
type PortableGuestArch = (typeof PORTABLE_GUEST_ARCHES)[number];

const PORTABLE_REFUSAL_CODES = [
  "checkpoint-refused",
  "checkpoint-invalid-abi",
  "checkpoint-invalid-roots",
  "checkpoint-inside-signal-handler",
  "checkpoint-inside-syscall",
  "checkpoint-unsupported-root",
  "checkpoint-unknown-root",
  "pointer-outside-known-object",
  "thread-count-unsupported",
  "thread-not-at-barrier",
  "thread-inside-syscall",
  "signal-handler-active",
  "mapping-executable-anonymous",
  "fd-kind-unsupported",
  "target-build-mismatch",
  "architecture-pair-unsupported",
  "architecture-unsupported",
  "build-id-mismatch",
  "entrypoint-missing",
  "feature-unsupported",
  "memory-layout-unsupported",
  "object-unsupported",
  "relocation-unsupported",
  "resource-unsupported",
  "syscall-unsupported",
] as const;
type PortableRefusalCode = (typeof PORTABLE_REFUSAL_CODES)[number];

interface PortableRefusal {
  code: PortableRefusalCode;
  message: string;
  detail?: Record<string, unknown>;
}

interface PortableUnsupportedVocabulary {
  vocabularyVersion: number;
  refusals: PortableRefusal[];
}

interface PortableCheckpointAbi {
  version: number;
  checkpointFunction: {
    name: string;
  };
  rootsType: "machinen_checkpoint_roots";
  restoreBundleType: "machinen_restore_bundle";
  safePoint: {
    outsideSignalHandlers: true;
    outsideSyscalls: true;
  };
}

interface PortableSnapshotManifest {
  formatVersion: number;
  sourceGuestArch: PortableGuestArch;
  allowedTargetGuestArchs: PortableGuestArch[];
  program: {
    name: string;
    executable: string;
    identity?: string;
  };
  sourceBuild: {
    buildId: string;
    version?: string;
  };
  targetBuild: {
    buildId?: string;
    version?: string;
  };
  checkpointAbi: PortableCheckpointAbi;
  checkpointContinuation: {
    name: string;
  };
  restoreEntrypoint: {
    name: string;
  };
  process: {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  };
  features: string[];
  unsupported: PortableUnsupportedVocabulary;
}

interface PortableSnapshotObjects {
  formatVersion: number;
  objects: Array<{
    id: string;
    kind: "global" | "heap" | "stack" | "thread" | "tls" | "opaque";
    type?: string;
    sizeBytes?: number;
    sourceAddress?: string;
    allocation?: {
      id: number;
      sourceAddress: string;
    };
    memory?: {
      offset: number;
      sizeBytes: number;
    };
    unsupported?: PortableUnsupportedVocabulary;
  }>;
  unsupported: PortableUnsupportedVocabulary;
}

interface PortableSnapshotRelocations {
  formatVersion: number;
  relocations: Array<{
    fromObject: string;
    fromOffset: number;
    toObject: string;
    addend?: number;
    kind?: "pointer" | "relative" | "symbol";
    sourcePointer?: string;
  }>;
  unsupported: PortableUnsupportedVocabulary;
}

interface PortableSnapshotResources {
  formatVersion: number;
  resources: Array<{
    id: string;
    kind: "argv" | "fd" | "file" | "socket" | "timer" | "signal" | "cwd" | "env" | "unknown";
    state: "captured" | "refused" | "unsupported";
    path?: string;
    fd?: number;
    flags?: string[];
    offset?: number;
    argv?: string[];
    env?: Record<string, string>;
    refusal?: PortableRefusal;
  }>;
  unsupported: PortableUnsupportedVocabulary;
}

interface PortableSnapshotDocuments {
  rootDir?: string;
  manifest: PortableSnapshotManifest;
  objects: PortableSnapshotObjects;
  relocations: PortableSnapshotRelocations;
  resources: PortableSnapshotResources;
}

interface PortableSnapshotDocumentInput {
  rootDir?: string;
  manifest: unknown;
  objects: unknown;
  relocations: unknown;
  resources: unknown;
}

type JsonSchema = Record<string, unknown>;

const REFUSAL_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: { enum: PORTABLE_REFUSAL_CODES },
    message: { type: "string", minLength: 1 },
    detail: { type: "object" },
  },
};

const UNSUPPORTED_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["vocabularyVersion", "refusals"],
  properties: {
    vocabularyVersion: { const: 1 },
    refusals: { type: "array", items: REFUSAL_SCHEMA },
  },
};

const SYMBOL_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_.$@-]*$" },
  },
};

const BUILD_ID_SCHEMA: JsonSchema = {
  type: "string",
  pattern: "^[0-9A-Fa-f]{8,128}$",
};

export const portableSnapshotSchemas = {
  manifest: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://machinen.dev/schemas/portable-snapshot/manifest.schema.json",
    title: "Machinen portable snapshot manifest",
    type: "object",
    additionalProperties: false,
    required: [
      "formatVersion",
      "sourceGuestArch",
      "allowedTargetGuestArchs",
      "program",
      "sourceBuild",
      "targetBuild",
      "checkpointAbi",
      "checkpointContinuation",
      "restoreEntrypoint",
      "process",
      "features",
      "unsupported",
    ],
    properties: {
      formatVersion: { const: PORTABLE_SNAPSHOT_FORMAT_VERSION },
      sourceGuestArch: { enum: PORTABLE_GUEST_ARCHES },
      allowedTargetGuestArchs: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { enum: PORTABLE_GUEST_ARCHES },
      },
      program: {
        type: "object",
        additionalProperties: false,
        required: ["name", "executable"],
        properties: {
          name: { type: "string", minLength: 1 },
          executable: { type: "string", minLength: 1 },
          identity: { type: "string", minLength: 1 },
        },
      },
      sourceBuild: {
        type: "object",
        additionalProperties: false,
        required: ["buildId"],
        properties: {
          buildId: BUILD_ID_SCHEMA,
          version: { type: "string", minLength: 1 },
        },
      },
      targetBuild: {
        type: "object",
        additionalProperties: false,
        anyOf: [{ required: ["buildId"] }, { required: ["version"] }],
        properties: {
          buildId: BUILD_ID_SCHEMA,
          version: { type: "string", minLength: 1 },
        },
      },
      checkpointAbi: {
        type: "object",
        additionalProperties: false,
        required: ["version", "checkpointFunction", "rootsType", "restoreBundleType", "safePoint"],
        properties: {
          version: { const: PORTABLE_CHECKPOINT_ABI_VERSION },
          checkpointFunction: SYMBOL_SCHEMA,
          rootsType: { const: PORTABLE_CHECKPOINT_ABI.rootsType },
          restoreBundleType: { const: PORTABLE_CHECKPOINT_ABI.restoreBundleType },
          safePoint: {
            type: "object",
            additionalProperties: false,
            required: ["outsideSignalHandlers", "outsideSyscalls"],
            properties: {
              outsideSignalHandlers: { const: true },
              outsideSyscalls: { const: true },
            },
          },
        },
      },
      checkpointContinuation: SYMBOL_SCHEMA,
      restoreEntrypoint: SYMBOL_SCHEMA,
      process: {
        type: "object",
        additionalProperties: false,
        required: ["argv", "env", "cwd"],
        properties: {
          argv: { type: "array", items: { type: "string" }, minItems: 1 },
          env: { type: "object", additionalProperties: { type: "string" } },
          cwd: { type: "string", pattern: "^/" },
        },
      },
      features: {
        type: "array",
        uniqueItems: true,
        items: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" },
      },
      unsupported: UNSUPPORTED_SCHEMA,
    },
  },
  objects: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://machinen.dev/schemas/portable-snapshot/objects.schema.json",
    title: "Machinen portable snapshot objects",
    type: "object",
    additionalProperties: false,
    required: ["formatVersion", "objects", "unsupported"],
    properties: {
      formatVersion: { const: PORTABLE_SNAPSHOT_FORMAT_VERSION },
      objects: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind"],
          properties: {
            id: { type: "string", minLength: 1 },
            kind: { enum: ["global", "heap", "stack", "thread", "tls", "opaque"] },
            type: { type: "string", minLength: 1 },
            sizeBytes: { type: "integer", minimum: 0 },
            sourceAddress: { type: "string", pattern: "^0x[0-9A-Fa-f]+$" },
            allocation: {
              type: "object",
              additionalProperties: false,
              required: ["id", "sourceAddress"],
              properties: {
                id: { type: "integer", minimum: 1 },
                sourceAddress: { type: "string", pattern: "^0x[0-9A-Fa-f]+$" },
              },
            },
            memory: {
              type: "object",
              additionalProperties: false,
              required: ["offset", "sizeBytes"],
              properties: {
                offset: { type: "integer", minimum: 0 },
                sizeBytes: { type: "integer", minimum: 0 },
              },
            },
            unsupported: UNSUPPORTED_SCHEMA,
          },
        },
      },
      unsupported: UNSUPPORTED_SCHEMA,
    },
  },
  relocations: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://machinen.dev/schemas/portable-snapshot/relocations.schema.json",
    title: "Machinen portable snapshot relocations",
    type: "object",
    additionalProperties: false,
    required: ["formatVersion", "relocations", "unsupported"],
    properties: {
      formatVersion: { const: PORTABLE_SNAPSHOT_FORMAT_VERSION },
      relocations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fromObject", "fromOffset", "toObject"],
          properties: {
            fromObject: { type: "string", minLength: 1 },
            fromOffset: { type: "integer", minimum: 0 },
            toObject: { type: "string", minLength: 1 },
            addend: { type: "integer" },
            kind: { enum: ["pointer", "relative", "symbol"] },
            sourcePointer: { type: "string", pattern: "^0x[0-9A-Fa-f]+$" },
          },
        },
      },
      unsupported: UNSUPPORTED_SCHEMA,
    },
  },
  resources: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://machinen.dev/schemas/portable-snapshot/resources.schema.json",
    title: "Machinen portable snapshot resources",
    type: "object",
    additionalProperties: false,
    required: ["formatVersion", "resources", "unsupported"],
    properties: {
      formatVersion: { const: PORTABLE_SNAPSHOT_FORMAT_VERSION },
      resources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind", "state"],
          properties: {
            id: { type: "string", minLength: 1 },
            kind: {
              enum: ["argv", "fd", "file", "socket", "timer", "signal", "cwd", "env", "unknown"],
            },
            state: { enum: ["captured", "refused", "unsupported"] },
            path: { type: "string" },
            fd: { type: "integer", minimum: 0 },
            flags: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
            offset: { type: "integer", minimum: 0 },
            argv: { type: "array", items: { type: "string" } },
            env: { type: "object", additionalProperties: { type: "string" } },
            refusal: REFUSAL_SCHEMA,
          },
        },
      },
      unsupported: UNSUPPORTED_SCHEMA,
    },
  },
} as const;

export class PortableSnapshotValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(["portable snapshot validation failed:", ...errors.map((e) => `  - ${e}`)].join("\n"));
    this.name = "PortableSnapshotValidationError";
    this.errors = errors;
  }
}

export function isPortableSnapshotBundle(dir: string): boolean {
  return existsSync(join(resolve(dir), PORTABLE_SNAPSHOT_FILES.manifest));
}

export function validatePortableSnapshotBundle(dir: string): PortableSnapshotDocuments {
  const rootDir = resolve(dir);
  const docs: PortableSnapshotDocuments = {
    rootDir,
    manifest: readPortableJson(
      rootDir,
      PORTABLE_SNAPSHOT_FILES.manifest,
    ) as PortableSnapshotManifest,
    objects: readPortableJson(rootDir, PORTABLE_SNAPSHOT_FILES.objects) as PortableSnapshotObjects,
    relocations: readPortableJson(
      rootDir,
      PORTABLE_SNAPSHOT_FILES.relocations,
    ) as PortableSnapshotRelocations,
    resources: readPortableJson(
      rootDir,
      PORTABLE_SNAPSHOT_FILES.resources,
    ) as PortableSnapshotResources,
  };
  const errors = validatePortableSnapshotDocuments(docs, { rootDir });
  if (errors.length > 0) {
    throw new PortableSnapshotValidationError(errors);
  }
  return docs;
}

function readPortableJson(rootDir: string, name: string): unknown {
  const path = join(rootDir, name);
  if (!existsSync(path)) {
    throw new PortableSnapshotValidationError([`${name} is missing`]);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new PortableSnapshotValidationError([
      `${name} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  }
}

export function validatePortableSnapshotDocuments(
  docs: PortableSnapshotDocumentInput,
  opts: { rootDir?: string } = {},
): string[] {
  const ctx = newValidationContext(opts.rootDir);
  validateManifest(ctx, docs.manifest);
  validateObjects(ctx, docs.objects);
  validateRelocations(ctx, docs.relocations, docs.objects);
  validateResources(ctx, docs.resources);
  validatePortableBundleFiles(ctx);
  return ctx.errors;
}

interface ValidationContext {
  rootDir?: string;
  errors: string[];
}

function newValidationContext(rootDir: string | undefined): ValidationContext {
  return { rootDir, errors: [] };
}

function validateManifest(ctx: ValidationContext, manifest: unknown): void {
  const m = expectRecord(ctx, "manifest", manifest);
  if (!m) {
    return;
  }
  validateFormatVersion(ctx, "manifest.formatVersion", m.formatVersion);
  validateArch(ctx, "manifest.sourceGuestArch", m.sourceGuestArch);
  validateAllowedTargetArchs(ctx, m.allowedTargetGuestArchs);
  validateProgram(ctx, m.program);
  validateSourceBuild(ctx, m.sourceBuild);
  validateTargetBuild(ctx, m.targetBuild);
  validateCheckpointAbi(ctx, m.checkpointAbi);
  validateSymbolObject(ctx, "manifest.checkpointContinuation", m.checkpointContinuation);
  validateSymbolObject(ctx, "manifest.restoreEntrypoint", m.restoreEntrypoint);
  validateProcess(ctx, m.process);
  validateStringArray(ctx, "manifest.features", m.features, { unique: true, pattern: FEATURE_RE });
  validateUnsupported(ctx, "manifest.unsupported", m.unsupported);
}

function validateObjects(ctx: ValidationContext, objectsDoc: unknown): void {
  const doc = expectRecord(ctx, "objects", objectsDoc);
  if (!doc) {
    return;
  }
  validateFormatVersion(ctx, "objects.formatVersion", doc.formatVersion);
  const objects = expectArray(ctx, "objects.objects", doc.objects);
  if (objects) {
    validateObjectEntries(ctx, objects);
  }
  validateUnsupported(ctx, "objects.unsupported", doc.unsupported);
}

function validateObjectEntries(ctx: ValidationContext, objects: unknown[]): void {
  const ids = new Set<string>();
  for (let i = 0; i < objects.length; i++) {
    validateObjectEntry(ctx, `objects.objects[${i}]`, objects[i], ids);
  }
}

function validateObjectEntry(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  ids: Set<string>,
): void {
  const obj = expectRecord(ctx, path, value);
  if (!obj) {
    return;
  }
  validateObjectId(ctx, path, obj.id, ids);
  validateEnum(ctx, `${path}.kind`, obj.kind, OBJECT_KINDS);
  validateOptionalObjectType(ctx, path, obj.type);
  validateOptionalObjectSize(ctx, path, obj.sizeBytes);
  validateOptionalObjectSourceAddress(ctx, path, obj.sourceAddress);
  validateOptionalObjectAllocation(ctx, path, obj.allocation);
  validateOptionalObjectMemory(ctx, path, obj.memory);
  validateOptionalObjectUnsupported(ctx, path, obj.unsupported);
}

function validateObjectId(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  ids: Set<string>,
): void {
  validateNonEmptyString(ctx, `${path}.id`, value);
  if (typeof value !== "string") {
    return;
  }
  if (ids.has(value)) {
    ctx.errors.push(`${path}.id duplicates object id ${JSON.stringify(value)}`);
  }
  ids.add(value);
}

function validateOptionalObjectType(ctx: ValidationContext, path: string, value: unknown): void {
  if (value !== undefined) {
    validateNonEmptyString(ctx, `${path}.type`, value);
  }
}

function validateOptionalObjectSize(ctx: ValidationContext, path: string, value: unknown): void {
  if (value !== undefined) {
    validateNonNegativeInteger(ctx, `${path}.sizeBytes`, value);
  }
}

function validateOptionalObjectSourceAddress(
  ctx: ValidationContext,
  path: string,
  value: unknown,
): void {
  if (value !== undefined) {
    validateHexAddress(ctx, `${path}.sourceAddress`, value);
  }
}

function validateOptionalObjectAllocation(
  ctx: ValidationContext,
  path: string,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }
  const allocation = expectRecord(ctx, `${path}.allocation`, value);
  if (!allocation) {
    return;
  }
  validatePositiveInteger(ctx, `${path}.allocation.id`, allocation.id);
  validateHexAddress(ctx, `${path}.allocation.sourceAddress`, allocation.sourceAddress);
}

function validateOptionalObjectMemory(ctx: ValidationContext, path: string, value: unknown): void {
  if (value !== undefined) {
    validateMemoryRange(ctx, `${path}.memory`, value);
  }
}

function validateOptionalObjectUnsupported(
  ctx: ValidationContext,
  path: string,
  value: unknown,
): void {
  if (value !== undefined) {
    validateUnsupported(ctx, `${path}.unsupported`, value);
  }
}

function validateRelocations(
  ctx: ValidationContext,
  relocationsDoc: unknown,
  objectsDoc: unknown,
): void {
  const doc = expectRecord(ctx, "relocations", relocationsDoc);
  if (!doc) {
    return;
  }
  validateFormatVersion(ctx, "relocations.formatVersion", doc.formatVersion);
  const objectIds = collectObjectIds(objectsDoc);
  const relocations = expectArray(ctx, "relocations.relocations", doc.relocations);
  if (relocations) {
    validateRelocationEntries(ctx, relocations, objectIds);
  }
  validateUnsupported(ctx, "relocations.unsupported", doc.unsupported);
}

function validateRelocationEntries(
  ctx: ValidationContext,
  relocations: unknown[],
  objectIds: Set<string>,
): void {
  for (let i = 0; i < relocations.length; i++) {
    validateRelocationEntry(ctx, `relocations.relocations[${i}]`, relocations[i], objectIds);
  }
}

function validateRelocationEntry(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  objectIds: Set<string>,
): void {
  const rel = expectRecord(ctx, path, value);
  if (!rel) {
    return;
  }
  validateObjectRef(ctx, `${path}.fromObject`, rel.fromObject, objectIds);
  validateNonNegativeInteger(ctx, `${path}.fromOffset`, rel.fromOffset);
  validateObjectRef(ctx, `${path}.toObject`, rel.toObject, objectIds);
  validateOptionalRelocationAddend(ctx, path, rel.addend);
  validateOptionalRelocationKind(ctx, path, rel.kind);
  validateOptionalRelocationSourcePointer(ctx, path, rel.sourcePointer);
}

function validateOptionalRelocationAddend(
  ctx: ValidationContext,
  path: string,
  value: unknown,
): void {
  if (value !== undefined) {
    validateInteger(ctx, `${path}.addend`, value);
  }
}

function validateOptionalRelocationKind(
  ctx: ValidationContext,
  path: string,
  value: unknown,
): void {
  if (value !== undefined) {
    validateEnum(ctx, `${path}.kind`, value, ["pointer", "relative", "symbol"]);
  }
}

function validateOptionalRelocationSourcePointer(
  ctx: ValidationContext,
  path: string,
  value: unknown,
): void {
  if (value !== undefined) {
    validateHexAddress(ctx, `${path}.sourcePointer`, value);
  }
}

function validateResources(ctx: ValidationContext, resourcesDoc: unknown): void {
  const doc = expectRecord(ctx, "resources", resourcesDoc);
  if (!doc) {
    return;
  }
  validateFormatVersion(ctx, "resources.formatVersion", doc.formatVersion);
  const resources = expectArray(ctx, "resources.resources", doc.resources);
  if (resources) {
    for (let i = 0; i < resources.length; i++) {
      const path = `resources.resources[${i}]`;
      const resource = expectRecord(ctx, path, resources[i]);
      if (!resource) {
        continue;
      }
      validateNonEmptyString(ctx, `${path}.id`, resource.id);
      validateEnum(ctx, `${path}.kind`, resource.kind, RESOURCE_KINDS);
      validateEnum(ctx, `${path}.state`, resource.state, ["captured", "refused", "unsupported"]);
      validateOptionalResourcePath(ctx, path, resource.path);
      validateOptionalResourceFd(ctx, path, resource.fd);
      validateOptionalResourceFlags(ctx, path, resource.flags);
      validateOptionalResourceOffset(ctx, path, resource.offset);
      validateOptionalResourceArgv(ctx, path, resource.argv);
      validateOptionalResourceEnv(ctx, path, resource.env);
      if (resource.refusal !== undefined) {
        validateRefusal(ctx, `${path}.refusal`, resource.refusal);
      }
    }
  }
  validateUnsupported(ctx, "resources.unsupported", doc.unsupported);
}

function validateOptionalResourcePath(ctx: ValidationContext, path: string, value: unknown): void {
  if (value !== undefined) {
    validateString(ctx, `${path}.path`, value);
  }
}

function validateOptionalResourceFd(ctx: ValidationContext, path: string, value: unknown): void {
  if (value !== undefined) {
    validateNonNegativeInteger(ctx, `${path}.fd`, value);
  }
}

function validateOptionalResourceFlags(ctx: ValidationContext, path: string, value: unknown): void {
  if (value !== undefined) {
    validateStringArray(ctx, `${path}.flags`, value, { unique: true });
  }
}

function validateOptionalResourceOffset(
  ctx: ValidationContext,
  path: string,
  value: unknown,
): void {
  if (value !== undefined) {
    validateNonNegativeInteger(ctx, `${path}.offset`, value);
  }
}

function validateOptionalResourceArgv(ctx: ValidationContext, path: string, value: unknown): void {
  if (value !== undefined) {
    validateStringArray(ctx, `${path}.argv`, value);
  }
}

function validateOptionalResourceEnv(ctx: ValidationContext, path: string, value: unknown): void {
  if (value !== undefined) {
    validateStringRecord(ctx, `${path}.env`, value);
  }
}

function validatePortableBundleFiles(ctx: ValidationContext): void {
  if (!ctx.rootDir) {
    return;
  }
  validateExistingFile(ctx, PORTABLE_SNAPSHOT_FILES.memory);
  validateExistingDirectory(ctx, PORTABLE_SNAPSHOT_FILES.logs);
}

function validateExistingFile(ctx: ValidationContext, name: string): void {
  validateExistingPath(ctx, name, name, "file", (stat) => stat.isFile());
}

function validateExistingDirectory(ctx: ValidationContext, name: string): void {
  validateExistingPath(ctx, name, `${name}/`, "directory", (stat) => stat.isDirectory());
}

function validateExistingPath(
  ctx: ValidationContext,
  name: string,
  label: string,
  kind: string,
  matchesKind: (stat: ReturnType<typeof statSync>) => boolean,
): void {
  const path = join(ctx.rootDir!, name);
  if (!existsSync(path)) {
    ctx.errors.push(`${label} is missing`);
    return;
  }
  if (!matchesKind(statSync(path))) {
    ctx.errors.push(`${label} must be a ${kind}`);
  }
}

function validateFormatVersion(ctx: ValidationContext, path: string, value: unknown): void {
  if (value !== PORTABLE_SNAPSHOT_FORMAT_VERSION) {
    ctx.errors.push(`${path} must be ${PORTABLE_SNAPSHOT_FORMAT_VERSION}`);
  }
}

function validateAllowedTargetArchs(ctx: ValidationContext, value: unknown): void {
  const arches = expectArray(ctx, "manifest.allowedTargetGuestArchs", value);
  if (!arches) {
    return;
  }
  if (arches.length === 0) {
    ctx.errors.push("manifest.allowedTargetGuestArchs must contain at least one architecture");
  }
  const seen = new Set<string>();
  for (let i = 0; i < arches.length; i++) {
    const arch = arches[i];
    validateArch(ctx, `manifest.allowedTargetGuestArchs[${i}]`, arch);
    if (typeof arch === "string") {
      if (seen.has(arch)) {
        ctx.errors.push(`manifest.allowedTargetGuestArchs duplicates ${JSON.stringify(arch)}`);
      }
      seen.add(arch);
    }
  }
}

function validateArch(ctx: ValidationContext, path: string, value: unknown): void {
  validateEnum(ctx, path, value, PORTABLE_GUEST_ARCHES);
}

function validateProgram(ctx: ValidationContext, value: unknown): void {
  const program = expectRecord(ctx, "manifest.program", value);
  if (!program) {
    return;
  }
  validateNonEmptyString(ctx, "manifest.program.name", program.name);
  validateNonEmptyString(ctx, "manifest.program.executable", program.executable);
  if (program.identity !== undefined) {
    validateNonEmptyString(ctx, "manifest.program.identity", program.identity);
  }
}

function validateSourceBuild(ctx: ValidationContext, value: unknown): void {
  const build = expectRecord(ctx, "manifest.sourceBuild", value);
  if (!build) {
    return;
  }
  validateBuildId(ctx, "manifest.sourceBuild.buildId", build.buildId);
  if (build.version !== undefined) {
    validateNonEmptyString(ctx, "manifest.sourceBuild.version", build.version);
  }
}

function validateTargetBuild(ctx: ValidationContext, value: unknown): void {
  const build = expectRecord(ctx, "manifest.targetBuild", value);
  if (!build) {
    return;
  }
  if (build.buildId === undefined && build.version === undefined) {
    ctx.errors.push("manifest.targetBuild must include buildId or version");
  }
  if (build.buildId !== undefined) {
    validateBuildId(ctx, "manifest.targetBuild.buildId", build.buildId);
  }
  if (build.version !== undefined) {
    validateNonEmptyString(ctx, "manifest.targetBuild.version", build.version);
  }
}

function validateCheckpointAbi(ctx: ValidationContext, value: unknown): void {
  const abi = expectRecord(ctx, "manifest.checkpointAbi", value);
  if (!abi) {
    return;
  }
  if (abi.version !== PORTABLE_CHECKPOINT_ABI_VERSION) {
    ctx.errors.push(`manifest.checkpointAbi.version must be ${PORTABLE_CHECKPOINT_ABI_VERSION}`);
  }
  validateSymbolObject(ctx, "manifest.checkpointAbi.checkpointFunction", abi.checkpointFunction);
  const checkpointFunction = isRecord(abi.checkpointFunction)
    ? abi.checkpointFunction.name
    : undefined;
  if (checkpointFunction !== PORTABLE_CHECKPOINT_ABI.checkpointFunction) {
    ctx.errors.push(
      `manifest.checkpointAbi.checkpointFunction.name must be ${PORTABLE_CHECKPOINT_ABI.checkpointFunction}`,
    );
  }
  if (abi.rootsType !== PORTABLE_CHECKPOINT_ABI.rootsType) {
    ctx.errors.push(
      `manifest.checkpointAbi.rootsType must be ${PORTABLE_CHECKPOINT_ABI.rootsType}`,
    );
  }
  if (abi.restoreBundleType !== PORTABLE_CHECKPOINT_ABI.restoreBundleType) {
    ctx.errors.push(
      `manifest.checkpointAbi.restoreBundleType must be ${PORTABLE_CHECKPOINT_ABI.restoreBundleType}`,
    );
  }
  validateCheckpointSafePoint(ctx, abi.safePoint);
}

function validateCheckpointSafePoint(ctx: ValidationContext, value: unknown): void {
  const safePoint = expectRecord(ctx, "manifest.checkpointAbi.safePoint", value);
  if (!safePoint) {
    return;
  }
  if (safePoint.outsideSignalHandlers !== true) {
    ctx.errors.push("manifest.checkpointAbi.safePoint.outsideSignalHandlers must be true");
  }
  if (safePoint.outsideSyscalls !== true) {
    ctx.errors.push("manifest.checkpointAbi.safePoint.outsideSyscalls must be true");
  }
}

function validateBuildId(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || !BUILD_ID_RE.test(value)) {
    ctx.errors.push(`${path} must be 8-128 hex characters`);
  }
}

function validateSymbolObject(ctx: ValidationContext, path: string, value: unknown): void {
  const symbol = expectRecord(ctx, path, value);
  if (!symbol) {
    return;
  }
  validateSymbolName(ctx, `${path}.name`, symbol.name);
}

function validateSymbolName(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || !SYMBOL_RE.test(value)) {
    ctx.errors.push(`${path} must be a valid symbol name`);
  }
}

function validateProcess(ctx: ValidationContext, value: unknown): void {
  const process = expectRecord(ctx, "manifest.process", value);
  if (!process) {
    return;
  }
  const argv = validateStringArray(ctx, "manifest.process.argv", process.argv, { minItems: 1 });
  if (argv && argv.length === 0) {
    ctx.errors.push("manifest.process.argv must contain argv[0]");
  }
  validateStringRecord(ctx, "manifest.process.env", process.env);
  validateAbsolutePath(ctx, "manifest.process.cwd", process.cwd);
}

function validateStringArray(
  ctx: ValidationContext,
  path: string,
  value: unknown,
  opts: { minItems?: number; unique?: boolean; pattern?: RegExp } = {},
): string[] | undefined {
  const arr = expectArray(ctx, path, value);
  if (!arr) {
    return undefined;
  }
  validateArrayMinItems(ctx, path, arr, opts.minItems);
  validateStringArrayItems(ctx, path, arr, opts);
  return arr.filter((v): v is string => typeof v === "string");
}

function validateArrayMinItems(
  ctx: ValidationContext,
  path: string,
  arr: unknown[],
  minItems: number | undefined,
): void {
  if (minItems !== undefined && arr.length < minItems) {
    ctx.errors.push(`${path} must contain at least ${minItems} item(s)`);
  }
}

function validateStringArrayItems(
  ctx: ValidationContext,
  path: string,
  arr: unknown[],
  opts: { unique?: boolean; pattern?: RegExp },
): void {
  const seen = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    validateStringArrayItem(ctx, path, i, arr[i], opts, seen);
  }
}

function validateStringArrayItem(
  ctx: ValidationContext,
  path: string,
  index: number,
  value: unknown,
  opts: { unique?: boolean; pattern?: RegExp },
  seen: Set<string>,
): void {
  const itemPath = `${path}[${index}]`;
  if (typeof value !== "string") {
    ctx.errors.push(`${itemPath} must be a string`);
    return;
  }
  validateStringArrayPattern(ctx, itemPath, value, opts.pattern);
  validateStringArrayUnique(ctx, path, value, opts.unique, seen);
}

function validateStringArrayPattern(
  ctx: ValidationContext,
  path: string,
  value: string,
  pattern: RegExp | undefined,
): void {
  if (pattern && !pattern.test(value)) {
    ctx.errors.push(`${path} has invalid shape`);
  }
}

function validateStringArrayUnique(
  ctx: ValidationContext,
  path: string,
  value: string,
  unique: boolean | undefined,
  seen: Set<string>,
): void {
  if (!unique) {
    return;
  }
  if (seen.has(value)) {
    ctx.errors.push(`${path} duplicates ${JSON.stringify(value)}`);
  }
  seen.add(value);
}

function validateStringRecord(ctx: ValidationContext, path: string, value: unknown): void {
  const record = expectRecord(ctx, path, value);
  if (!record) {
    return;
  }
  for (const [key, entryValue] of Object.entries(record)) {
    if (entryValue !== undefined && typeof entryValue !== "string") {
      ctx.errors.push(`${path}.${key} must be a string`);
    }
  }
}

function validateAbsolutePath(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || !value.startsWith("/")) {
    ctx.errors.push(`${path} must be an absolute path`);
  }
}

function validateMemoryRange(ctx: ValidationContext, path: string, value: unknown): void {
  const memory = expectRecord(ctx, path, value);
  if (!memory) {
    return;
  }
  validateNonNegativeInteger(ctx, `${path}.offset`, memory.offset);
  validateNonNegativeInteger(ctx, `${path}.sizeBytes`, memory.sizeBytes);
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

function collectObjectIds(objectsDoc: unknown): Set<string> {
  const ids = new Set<string>();
  if (!isRecord(objectsDoc) || !Array.isArray(objectsDoc.objects)) {
    return ids;
  }
  for (const obj of objectsDoc.objects) {
    if (isRecord(obj) && typeof obj.id === "string") {
      ids.add(obj.id);
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
  validateEnum(ctx, `${path}.code`, refusal.code, PORTABLE_REFUSAL_CODES);
  validateNonEmptyString(ctx, `${path}.message`, refusal.message);
  if (refusal.detail !== undefined && !isRecord(refusal.detail)) {
    ctx.errors.push(`${path}.detail must be an object`);
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

function validateInteger(ctx: ValidationContext, path: string, value: unknown): void {
  if (!Number.isInteger(value)) {
    ctx.errors.push(`${path} must be an integer`);
  }
}

function validatePositiveInteger(ctx: ValidationContext, path: string, value: unknown): void {
  if (!Number.isInteger(value) || Number(value) < 1) {
    ctx.errors.push(`${path} must be a positive integer`);
  }
}

function validateNonNegativeInteger(ctx: ValidationContext, path: string, value: unknown): void {
  if (!Number.isInteger(value) || Number(value) < 0) {
    ctx.errors.push(`${path} must be a non-negative integer`);
  }
}

function validateHexAddress(ctx: ValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    ctx.errors.push(`${path} must be a hex address`);
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

const OBJECT_KINDS = ["global", "heap", "stack", "thread", "tls", "opaque"] as const;
const RESOURCE_KINDS = [
  "argv",
  "fd",
  "file",
  "socket",
  "timer",
  "signal",
  "cwd",
  "env",
  "unknown",
] as const;
const ADDRESS_RE = /^0x[0-9A-Fa-f]+$/;
const BUILD_ID_RE = /^[0-9A-Fa-f]{8,128}$/;
const SYMBOL_RE = /^[A-Za-z_][A-Za-z0-9_.$@-]*$/;
const FEATURE_RE = /^[a-z0-9][a-z0-9._-]*$/;
