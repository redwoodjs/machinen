import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const PORTABLE_SNAPSHOT_FORMAT_VERSION = 1;

export const PORTABLE_SNAPSHOT_FILES = {
  manifest: "manifest.json",
  memory: "memory.bin",
  objects: "objects.json",
  relocations: "relocations.json",
  resources: "resources.json",
  logs: "logs",
} as const;

export const PORTABLE_GUEST_ARCHES = ["arm64", "amd64"] as const;
export type PortableGuestArch = (typeof PORTABLE_GUEST_ARCHES)[number];

export const PORTABLE_REFUSAL_CODES = [
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
export type PortableRefusalCode = (typeof PORTABLE_REFUSAL_CODES)[number];

export interface PortableRefusal {
  code: PortableRefusalCode;
  message: string;
  detail?: Record<string, unknown>;
}

export interface PortableUnsupportedVocabulary {
  vocabularyVersion: number;
  refusals: PortableRefusal[];
}

export interface PortableSnapshotManifest {
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

export interface PortableSnapshotObjects {
  formatVersion: number;
  objects: Array<{
    id: string;
    kind: "global" | "heap" | "stack" | "thread" | "tls" | "opaque";
    type?: string;
    sizeBytes?: number;
    memory?: {
      offset: number;
      sizeBytes: number;
    };
    unsupported?: PortableUnsupportedVocabulary;
  }>;
  unsupported: PortableUnsupportedVocabulary;
}

export interface PortableSnapshotRelocations {
  formatVersion: number;
  relocations: Array<{
    fromObject: string;
    fromOffset: number;
    toObject: string;
    addend?: number;
    kind?: "pointer" | "relative" | "symbol";
  }>;
  unsupported: PortableUnsupportedVocabulary;
}

export interface PortableSnapshotResources {
  formatVersion: number;
  resources: Array<{
    id: string;
    kind: "fd" | "file" | "socket" | "timer" | "signal" | "cwd" | "env" | "unknown";
    state: "captured" | "refused" | "unsupported";
    path?: string;
    refusal?: PortableRefusal;
  }>;
  unsupported: PortableUnsupportedVocabulary;
}

export interface PortableSnapshotDocuments {
  rootDir?: string;
  manifest: PortableSnapshotManifest;
  objects: PortableSnapshotObjects;
  relocations: PortableSnapshotRelocations;
  resources: PortableSnapshotResources;
}

export interface PortableSnapshotDocumentInput {
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
            kind: { enum: ["fd", "file", "socket", "timer", "signal", "cwd", "env", "unknown"] },
            state: { enum: ["captured", "refused", "unsupported"] },
            path: { type: "string" },
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
    const ids = new Set<string>();
    for (let i = 0; i < objects.length; i++) {
      const path = `objects.objects[${i}]`;
      const obj = expectRecord(ctx, path, objects[i]);
      if (!obj) {
        continue;
      }
      validateNonEmptyString(ctx, `${path}.id`, obj.id);
      if (typeof obj.id === "string") {
        if (ids.has(obj.id)) {
          ctx.errors.push(`${path}.id duplicates object id ${JSON.stringify(obj.id)}`);
        }
        ids.add(obj.id);
      }
      validateEnum(ctx, `${path}.kind`, obj.kind, [
        "global",
        "heap",
        "stack",
        "thread",
        "tls",
        "opaque",
      ]);
      if (obj.type !== undefined) {
        validateNonEmptyString(ctx, `${path}.type`, obj.type);
      }
      if (obj.sizeBytes !== undefined) {
        validateNonNegativeInteger(ctx, `${path}.sizeBytes`, obj.sizeBytes);
      }
      if (obj.memory !== undefined) {
        validateMemoryRange(ctx, `${path}.memory`, obj.memory);
      }
      if (obj.unsupported !== undefined) {
        validateUnsupported(ctx, `${path}.unsupported`, obj.unsupported);
      }
    }
  }
  validateUnsupported(ctx, "objects.unsupported", doc.unsupported);
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
    for (let i = 0; i < relocations.length; i++) {
      const path = `relocations.relocations[${i}]`;
      const rel = expectRecord(ctx, path, relocations[i]);
      if (!rel) {
        continue;
      }
      validateObjectRef(ctx, `${path}.fromObject`, rel.fromObject, objectIds);
      validateNonNegativeInteger(ctx, `${path}.fromOffset`, rel.fromOffset);
      validateObjectRef(ctx, `${path}.toObject`, rel.toObject, objectIds);
      if (rel.addend !== undefined) {
        validateInteger(ctx, `${path}.addend`, rel.addend);
      }
      if (rel.kind !== undefined) {
        validateEnum(ctx, `${path}.kind`, rel.kind, ["pointer", "relative", "symbol"]);
      }
    }
  }
  validateUnsupported(ctx, "relocations.unsupported", doc.unsupported);
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
      validateEnum(ctx, `${path}.kind`, resource.kind, [
        "fd",
        "file",
        "socket",
        "timer",
        "signal",
        "cwd",
        "env",
        "unknown",
      ]);
      validateEnum(ctx, `${path}.state`, resource.state, ["captured", "refused", "unsupported"]);
      if (resource.path !== undefined) {
        validateString(ctx, `${path}.path`, resource.path);
      }
      if (resource.refusal !== undefined) {
        validateRefusal(ctx, `${path}.refusal`, resource.refusal);
      }
    }
  }
  validateUnsupported(ctx, "resources.unsupported", doc.unsupported);
}

function validatePortableBundleFiles(ctx: ValidationContext): void {
  if (!ctx.rootDir) {
    return;
  }
  validateExistingFile(ctx, PORTABLE_SNAPSHOT_FILES.memory);
  validateExistingDirectory(ctx, PORTABLE_SNAPSHOT_FILES.logs);
}

function validateExistingFile(ctx: ValidationContext, name: string): void {
  const path = join(ctx.rootDir!, name);
  if (!existsSync(path)) {
    ctx.errors.push(`${name} is missing`);
    return;
  }
  if (!statSync(path).isFile()) {
    ctx.errors.push(`${name} must be a file`);
  }
}

function validateExistingDirectory(ctx: ValidationContext, name: string): void {
  const path = join(ctx.rootDir!, name);
  if (!existsSync(path)) {
    ctx.errors.push(`${name}/ is missing`);
    return;
  }
  if (!statSync(path).isDirectory()) {
    ctx.errors.push(`${name}/ must be a directory`);
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
  if (opts.minItems !== undefined && arr.length < opts.minItems) {
    ctx.errors.push(`${path} must contain at least ${opts.minItems} item(s)`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const itemPath = `${path}[${i}]`;
    if (typeof item !== "string") {
      ctx.errors.push(`${itemPath} must be a string`);
      continue;
    }
    if (opts.pattern && !opts.pattern.test(item)) {
      ctx.errors.push(`${itemPath} has invalid shape`);
    }
    if (opts.unique) {
      if (seen.has(item)) {
        ctx.errors.push(`${path} duplicates ${JSON.stringify(item)}`);
      }
      seen.add(item);
    }
  }
  return arr.filter((v): v is string => typeof v === "string");
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

const BUILD_ID_RE = /^[0-9A-Fa-f]{8,128}$/;
const SYMBOL_RE = /^[A-Za-z_][A-Za-z0-9_.$@-]*$/;
const FEATURE_RE = /^[a-z0-9][a-z0-9._-]*$/;
