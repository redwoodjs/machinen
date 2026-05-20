import { Buffer } from "node:buffer";
import { RUNTIME_ADAPTER_BUNDLE_FILE, assertRuntimeAdapterDocument } from "./runtime-adapter.ts";
import type {
  RuntimeAdapterBuild,
  RuntimeAdapterDocument,
  RuntimeAdapterGraph,
  RuntimeAdapterObjectNode,
  RuntimeAdapterRefusal,
  RuntimeAdapterResource,
  RuntimeAdapterResourceKind,
  RuntimeAdapterResources,
  RuntimeAdapterRoot,
  RuntimeAdapterTarget,
  RuntimeAdapterUnsupportedVocabulary,
  RuntimeAdapterValue,
} from "./runtime-adapter.ts";

export interface NodeRuntimeFileResource {
  id: string;
  path: string;
  flags: string[];
  offset?: number;
}

export interface NodeRuntimeNativeHandleRefusal {
  id: string;
  kind: RuntimeAdapterResourceKind;
  code?: RuntimeAdapterRefusal["code"];
  message: string;
  detail?: Record<string, unknown>;
}

export interface CaptureNodeNativeResourcesOptions {
  argv?: string[];
  env?: Record<string, string>;
  cwd?: string;
  files?: NodeRuntimeFileResource[];
  includeStdioRefusals?: boolean;
  nativeHandleRefusals?: NodeRuntimeNativeHandleRefusal[];
  extraResources?: RuntimeAdapterResource[];
}

export interface RestoredNodeResourceRecipes {
  argv?: string[];
  env?: Record<string, string>;
  cwd?: string;
  files: NodeRuntimeFileResource[];
}

export interface CaptureNodeRuntimeAdapterOptions {
  adapterId?: string;
  adapterVersion?: string;
  target?: Partial<RuntimeAdapterTarget>;
  build?: Partial<RuntimeAdapterBuild>;
  process?: {
    argv?: string[];
    env?: Record<string, string>;
    cwd?: string;
  };
  resources?: RuntimeAdapterResource[];
  files?: NodeRuntimeFileResource[];
  includeStdioRefusals?: boolean;
  nativeHandleRefusals?: NodeRuntimeNativeHandleRefusal[];
}

export const NODE_RUNTIME_NATIVE_RESOURCE_KINDS = [
  "argv",
  "env",
  "cwd",
  "file",
  "fd",
  "socket",
  "timer",
  "child-process",
  "worker",
  "pty",
  "fs-watch",
  "native-handle",
] as const;

export class NodeRuntimeAdapterUnsupportedError extends Error {
  readonly refusals: RuntimeAdapterRefusal[];

  constructor(refusals: RuntimeAdapterRefusal[]) {
    super(
      [
        "node runtime adapter refused unsupported semantic state:",
        ...refusals.map((refusal) => `  - ${refusal.code}: ${refusal.message}`),
      ].join("\n"),
    );
    this.name = "NodeRuntimeAdapterUnsupportedError";
    this.refusals = refusals;
  }
}

export function captureNodeRuntimeAdapterDocument(
  roots: Record<string, unknown>,
  options: CaptureNodeRuntimeAdapterOptions = {},
): RuntimeAdapterDocument {
  const encoder = new NodeGraphEncoder();
  const graphRoots = Object.entries(roots).map(([name, value]) => ({
    name,
    value: encoder.encode(value),
  }));
  const resources = nodeResources(options);
  const refusals = [...encoder.refusals, ...resources.unsupported.refusals];
  const document: RuntimeAdapterDocument = {
    formatVersion: 1,
    adapter: {
      id: options.adapterId ?? "node-cooperative-runtime-adapter",
      protocolVersion: 1,
      runtime: "node",
      name: "Machinen cooperative Node runtime adapter",
      version: options.adapterVersion ?? "0.1.0",
      features: [
        "semantic-roots",
        "object-identity",
        "cycles",
        "map-set",
        "bytes",
        "native-resource-refusals",
      ],
      entrypoints: {
        capture: {
          command: "node",
          args: ["<adapter>", "capture", "--out", "<bundle>"],
          transport: "sidecar-json",
          env: { MACHINEN_RUNTIME_ADAPTER: "1" },
        },
        restore: {
          command: "node",
          args: ["<adapter>", "restore", "--bundle", "<bundle>"],
          transport: "sidecar-json",
          env: { MACHINEN_RUNTIME_ADAPTER: "1" },
        },
      },
    },
    target: nodeTarget(options.target),
    runtime: {
      name: "node",
      version: nodeVersion(),
      engine: { name: "v8", version: nodeV8Version() },
      serializerCompatibility: {
        semanticGraph: { supported: true, format: "machinen-runtime-adapter-v1" },
        rawHeap: {
          supported: false,
          refusal: {
            code: "runtime-heap-unsupported",
            message: "raw V8 heap bytes are not a portable restore contract",
          },
        },
        v8Serialize: {
          supported: true,
          versionBound: true,
          portable: false,
          api: "node:v8.serialize",
        },
        structuredClone: {
          supported: typeof structuredClone === "function",
          persistentFormat: false,
        },
        heapSnapshot: {
          inspected: false,
          restoreSupported: false,
          finding: "heap snapshots are inspection evidence, not a restore contract",
        },
      },
    },
    build: nodeBuild(options.build),
    process: {
      argv: options.process?.argv ?? globalThis.process?.argv ?? ["node"],
      env: options.process?.env ?? { MACHINEN_RUNTIME_ADAPTER: "1" },
      cwd: options.process?.cwd ?? globalThis.process?.cwd?.() ?? "/",
    },
    graph: {
      roots: graphRoots,
      objects: encoder.objects,
      identityAssertions: [],
      checksumHex: checksumGraphShape(graphRoots, encoder.objects),
    },
    resources,
    restore: {
      semanticStateSupported: refusals.length === 0,
      liveProcessSupported: false,
      requiredMetadata: [
        "semantic JS roots with reference ids",
        "module graph and source/build identity",
        "native handle recipes or refusals",
        "async queue continuation metadata",
      ],
      refusal: refusals[0] ?? {
        code: "runtime-heap-unsupported",
        message: "full live Node process restore still needs runtime heap and async metadata",
      },
    },
    bundleMapping: {
      manifestFeatures: ["runtime-adapter", "node-semantic-roots", "js-object-identity"],
      sidecarFiles: [RUNTIME_ADAPTER_BUNDLE_FILE],
      objects: [
        {
          portableObjectId: "js-root-state",
          role: "runtime-roots",
          graphObjectIds: encoder.objects.map((object) => object.id),
        },
        { portableObjectId: "js-object-graph", role: "runtime-object-graph" },
        { portableObjectId: "js-runtime-metadata", role: "runtime-metadata" },
      ],
      resources: resources.resources.map((resource) => ({
        portableResourceId: resource.id,
        runtimeResourceId: resource.id,
      })),
    },
    unsupported: unsupported(refusals),
  };
  return assertRuntimeAdapterDocument(document);
}

export function captureNodeNativeResources(
  options: CaptureNodeNativeResourcesOptions = {},
): RuntimeAdapterResources {
  const resources: RuntimeAdapterResource[] = [
    {
      id: "argv",
      kind: "argv",
      state: "captured",
      recipe: { kind: "argv", detail: { argv: options.argv ?? globalThis.process?.argv ?? [] } },
    },
    {
      id: "env",
      kind: "env",
      state: "captured",
      recipe: { kind: "env", detail: { env: options.env ?? { MACHINEN_RUNTIME_ADAPTER: "1" } } },
    },
    {
      id: "cwd",
      kind: "cwd",
      state: "captured",
      recipe: { kind: "cwd", detail: { cwd: options.cwd ?? globalThis.process?.cwd?.() ?? "/" } },
    },
    ...(options.files ?? []).map((file) => fileResource(file)),
    ...(options.includeStdioRefusals ? stdioRefusals() : []),
    ...(options.nativeHandleRefusals ?? []).map((handle) => refusedResource(handle)),
    ...(options.extraResources ?? []),
  ];
  return {
    resources,
    unsupported: unsupported(
      resources.flatMap((resource) =>
        resource.state === "captured" || !resource.refusal ? [] : [resource.refusal],
      ),
    ),
  };
}

export function restoreNodeCapturedResourceRecipes(
  resources: RuntimeAdapterResources,
): RestoredNodeResourceRecipes {
  const refusals = resources.resources.flatMap((resource) =>
    resource.state === "captured" || !resource.refusal ? [] : [resource.refusal],
  );
  if (refusals.length > 0) {
    throw new NodeRuntimeAdapterUnsupportedError(refusals);
  }
  const restored: RestoredNodeResourceRecipes = { files: [] };
  for (const resource of resources.resources) {
    applyCapturedResource(restored, resource);
  }
  return restored;
}

export function restoreNodeRuntimeAdapterRoots(
  document: RuntimeAdapterDocument,
): Record<string, unknown> {
  const restoredDocument = assertRuntimeAdapterDocument(document);
  const refusals = collectNodeRuntimeAdapterRefusals(restoredDocument);
  if (refusals.some((refusal) => refusal.code === "object-unsupported")) {
    throw new NodeRuntimeAdapterUnsupportedError(refusals);
  }
  return new NodeGraphDecoder(restoredDocument.graph).restoreRoots();
}

export function collectNodeRuntimeAdapterRefusals(
  document: RuntimeAdapterDocument,
): RuntimeAdapterRefusal[] {
  return [
    ...document.unsupported.refusals,
    ...document.resources.unsupported.refusals,
    ...document.resources.resources.flatMap((resource) =>
      resource.refusal ? [resource.refusal] : [],
    ),
    ...document.graph.objects.flatMap((object) => (object.refusal ? [object.refusal] : [])),
  ];
}

// fallow-ignore-next-line complexity
function nodeTarget(target: Partial<RuntimeAdapterTarget> | undefined): RuntimeAdapterTarget {
  return {
    id: target?.id ?? "node-runtime-target",
    name: target?.name ?? "node-runtime-target",
    executable: target?.executable ?? globalThis.process?.execPath ?? "node",
    sourceGuestArch: target?.sourceGuestArch ?? hostArch(),
    allowedTargetGuestArchs: target?.allowedTargetGuestArchs ?? ["arm64", "amd64"],
  };
}

function nodeBuild(build: Partial<RuntimeAdapterBuild> | undefined): RuntimeAdapterBuild {
  return {
    identity: build?.identity ?? {},
    modules: build?.modules ?? [],
  };
}

function nodeResources(options: CaptureNodeRuntimeAdapterOptions): RuntimeAdapterResources {
  return captureNodeNativeResources({
    argv: options.process?.argv,
    env: options.process?.env,
    cwd: options.process?.cwd,
    files: options.files,
    includeStdioRefusals: options.includeStdioRefusals,
    nativeHandleRefusals: options.nativeHandleRefusals,
    extraResources: options.resources,
  });
}

function fileResource(file: NodeRuntimeFileResource): RuntimeAdapterResource {
  return {
    id: file.id,
    kind: "file",
    state: "captured",
    recipe: {
      kind: "file",
      detail: { path: file.path, flags: file.flags, offset: file.offset ?? 0 },
    },
  };
}

function stdioRefusals(): RuntimeAdapterResource[] {
  return [0, 1, 2].map((fd) => ({
    id: `node:stdio:${fd}`,
    kind: "fd" as const,
    state: "refused" as const,
    refusal: {
      code: "fd-kind-unsupported" as const,
      message: `stdio fd ${fd} is a native handle and needs a host capability recipe`,
      detail: { fd },
    },
  }));
}

function refusedResource(handle: NodeRuntimeNativeHandleRefusal): RuntimeAdapterResource {
  return {
    id: handle.id,
    kind: handle.kind,
    state: "refused",
    refusal: {
      code: handle.code ?? defaultRefusalCode(handle.kind),
      message: handle.message,
      detail: handle.detail,
    },
  };
}

function defaultRefusalCode(kind: RuntimeAdapterResourceKind): RuntimeAdapterRefusal["code"] {
  if (kind === "timer") {
    return "runtime-heap-unsupported";
  }
  if (kind === "fd") {
    return "fd-kind-unsupported";
  }
  return "resource-unsupported";
}

// fallow-ignore-next-line complexity
function applyCapturedResource(
  restored: RestoredNodeResourceRecipes,
  resource: RuntimeAdapterResource,
): void {
  const detail = resource.recipe?.detail ?? {};
  if (resource.id === "argv" && Array.isArray(detail.argv)) {
    restored.argv = detail.argv.filter((item): item is string => typeof item === "string");
  } else if (resource.id === "env" && isStringRecord(detail.env)) {
    restored.env = detail.env;
  } else if (resource.id === "cwd" && typeof detail.cwd === "string") {
    restored.cwd = detail.cwd;
  } else if (resource.kind === "file") {
    restored.files.push({
      id: resource.id,
      path: typeof detail.path === "string" ? detail.path : "",
      flags: Array.isArray(detail.flags)
        ? detail.flags.filter((item): item is string => typeof item === "string")
        : [],
      offset: typeof detail.offset === "number" ? detail.offset : 0,
    });
  }
}

class NodeGraphEncoder {
  readonly objects: RuntimeAdapterObjectNode[] = [];
  readonly refusals: RuntimeAdapterRefusal[] = [];
  private readonly seen = new WeakMap<object, string>();
  private unsupportedCount = 0;

  encode(value: unknown): RuntimeAdapterValue {
    if (value === undefined) {
      return { kind: "undefined" };
    }
    if (value === null) {
      return { kind: "null" };
    }
    if (typeof value === "boolean") {
      return { kind: "boolean", value };
    }
    if (typeof value === "number") {
      return this.encodeNumber(value);
    }
    if (typeof value === "bigint") {
      return { kind: "bigint", decimal: value.toString() };
    }
    if (typeof value === "string") {
      return { kind: "string", value };
    }
    if (typeof value === "symbol" || typeof value === "function") {
      return this.unsupportedValue(typeof value, value);
    }
    return this.encodeObject(value as object);
  }

  private encodeNumber(value: number): RuntimeAdapterValue {
    if (Number.isFinite(value)) {
      return { kind: "number", value };
    }
    return this.unsupportedValue("number", value);
  }

  private encodeObject(value: object): RuntimeAdapterValue {
    const existing = this.seen.get(value);
    if (existing) {
      return { kind: "ref", objectId: existing };
    }
    const id = `object:${this.objects.length + 1}`;
    this.seen.set(value, id);
    const node = this.createNode(id, value);
    this.objects.push(node);
    this.populateNode(node, value);
    return { kind: "ref", objectId: id };
  }

  // fallow-ignore-next-line complexity
  private createNode(id: string, value: object): RuntimeAdapterObjectNode {
    if (Buffer.isBuffer(value)) {
      return { id, kind: "typed-array", type: "Buffer", byteLength: value.byteLength };
    }
    if (value instanceof ArrayBuffer) {
      return { id, kind: "array-buffer", type: "ArrayBuffer", byteLength: value.byteLength };
    }
    if (ArrayBuffer.isView(value)) {
      return {
        id,
        kind: "typed-array",
        type: value.constructor.name,
        byteLength: value.byteLength,
      };
    }
    if (Array.isArray(value)) {
      return { id, kind: "array", type: "Array" };
    }
    if (value instanceof Map) {
      return { id, kind: "map", type: "Map" };
    }
    if (value instanceof Set) {
      return { id, kind: "set", type: "Set" };
    }
    if (value instanceof Date) {
      return { id, kind: "date", type: "Date" };
    }
    if (value instanceof RegExp) {
      return { id, kind: "regexp", type: "RegExp" };
    }
    if (value instanceof Error) {
      return { id, kind: "error", type: value.name || "Error" };
    }
    return { id, kind: "object", type: value.constructor?.name ?? "Object" };
  }

  // fallow-ignore-next-line complexity
  private populateNode(node: RuntimeAdapterObjectNode, value: object): void {
    if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      node.properties = { bytes: bytesValue(value) };
      return;
    }
    if (Array.isArray(value)) {
      node.elements = value.map((item) => this.encode(item));
      return;
    }
    if (value instanceof Map) {
      node.entries = [...value.entries()].map(([key, entryValue]) => ({
        key: this.encode(key),
        value: this.encode(entryValue),
      }));
      return;
    }
    if (value instanceof Set) {
      node.entries = [...value.values()].map((entryValue) => ({
        key: this.encode(entryValue),
        value: this.encode(entryValue),
      }));
      return;
    }
    if (value instanceof Date) {
      node.properties = { iso: { kind: "string", value: value.toISOString() } };
      return;
    }
    if (value instanceof RegExp) {
      node.properties = {
        source: { kind: "string", value: value.source },
        flags: { kind: "string", value: value.flags },
      };
      return;
    }
    if (value instanceof Error) {
      node.properties = {
        name: { kind: "string", value: value.name },
        message: { kind: "string", value: value.message },
      };
      return;
    }
    node.properties = Object.fromEntries(
      Object.entries(value).map(([name, propertyValue]) => [name, this.encode(propertyValue)]),
    );
  }

  private unsupportedValue(kind: string, value: unknown): RuntimeAdapterValue {
    const id = `unsupported:${++this.unsupportedCount}`;
    const refusal: RuntimeAdapterRefusal = {
      code: "object-unsupported",
      message: `Node runtime adapter cannot capture ${kind} values as portable semantic state`,
      detail: { type: kind, description: String(value) },
    };
    this.refusals.push(refusal);
    this.objects.push({ id, kind: "opaque", type: kind, refusal });
    return { kind: "ref", objectId: id };
  }
}

class NodeGraphDecoder {
  private readonly byId = new Map<string, unknown>();

  constructor(private readonly graph: RuntimeAdapterGraph) {}

  restoreRoots(): Record<string, unknown> {
    this.instantiateObjects();
    this.populateObjects();
    return Object.fromEntries(
      this.graph.roots.map((root) => [root.name, this.decodeValue(root.value)]),
    );
  }

  private instantiateObjects(): void {
    for (const node of this.graph.objects) {
      this.byId.set(node.id, this.emptyValue(node));
    }
  }

  // fallow-ignore-next-line complexity
  private emptyValue(node: RuntimeAdapterObjectNode): unknown {
    if (node.refusal) {
      throw new NodeRuntimeAdapterUnsupportedError([node.refusal]);
    }
    switch (node.kind) {
      case "array":
        return [];
      case "map":
        return new Map<unknown, unknown>();
      case "set":
        return new Set<unknown>();
      case "date":
        return new Date(stringProperty(node, "iso"));
      case "regexp":
        return new RegExp(stringProperty(node, "source"), stringProperty(node, "flags"));
      case "array-buffer":
        return bufferFromNode(node).buffer.slice(0);
      case "typed-array":
        return typedArrayFromNode(node);
      case "error":
        return new Error(stringProperty(node, "message"));
      case "object":
        return {};
      case "opaque":
        return {};
      default:
        assertNeverObjectKind(node.kind);
    }
  }

  // fallow-ignore-next-line complexity
  private populateObjects(): void {
    for (const node of this.graph.objects) {
      const target = this.byId.get(node.id);
      if (Array.isArray(target)) {
        target.push(...(node.elements ?? []).map((value) => this.decodeValue(value)));
      } else if (target instanceof Map) {
        for (const entry of node.entries ?? []) {
          target.set(this.decodeValue(entry.key), this.decodeValue(entry.value));
        }
      } else if (target instanceof Set) {
        for (const entry of node.entries ?? []) {
          target.add(this.decodeValue(entry.value));
        }
      } else if (isPlainRestoredObject(target)) {
        Object.assign(target, this.decodeProperties(node));
      }
    }
  }

  private decodeProperties(node: RuntimeAdapterObjectNode): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(node.properties ?? {}).map(([name, value]) => [name, this.decodeValue(value)]),
    );
  }

  // fallow-ignore-next-line complexity
  private decodeValue(value: RuntimeAdapterValue): unknown {
    switch (value.kind) {
      case "undefined":
        return undefined;
      case "null":
        return null;
      case "boolean":
      case "number":
      case "string":
        return value.value;
      case "bigint":
        return BigInt(value.decimal);
      case "bytes":
        return Buffer.from(value.base64, "base64");
      case "array":
        return value.items.map((item) => this.decodeValue(item));
      case "ref":
        return this.byId.get(value.objectId);
      default:
        assertNeverValueKind(value);
    }
  }
}

function bytesValue(value: object): RuntimeAdapterValue {
  const bytes = bufferFromBytesObject(value);
  return { kind: "bytes", base64: bytes.toString("base64"), byteLength: bytes.byteLength };
}

function bufferFromBytesObject(value: object): Buffer {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return Buffer.alloc(0);
}

function bufferFromNode(node: RuntimeAdapterObjectNode): Buffer {
  const bytes = node.properties?.bytes;
  if (!bytes || bytes.kind !== "bytes") {
    return Buffer.alloc(0);
  }
  return Buffer.from(bytes.base64, "base64");
}

// fallow-ignore-next-line complexity
function typedArrayFromNode(node: RuntimeAdapterObjectNode): unknown {
  const bytes = bufferFromNode(node);
  switch (node.type) {
    case "Buffer":
      return Buffer.from(bytes);
    case "Uint8Array":
    case "DataView":
      return new Uint8Array(bytes);
    case "Uint16Array":
      return new Uint16Array(copyArrayBuffer(bytes));
    case "Uint32Array":
      return new Uint32Array(copyArrayBuffer(bytes));
    case "Int8Array":
      return new Int8Array(bytes);
    case "Int16Array":
      return new Int16Array(copyArrayBuffer(bytes));
    case "Int32Array":
      return new Int32Array(copyArrayBuffer(bytes));
    case "Float32Array":
      return new Float32Array(copyArrayBuffer(bytes));
    case "Float64Array":
      return new Float64Array(copyArrayBuffer(bytes));
    default:
      return new Uint8Array(bytes);
  }
}

function copyArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function stringProperty(node: RuntimeAdapterObjectNode, name: string): string {
  const value = node.properties?.[name];
  return value?.kind === "string" ? value.value : "";
}

// fallow-ignore-next-line complexity
function isPlainRestoredObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return (
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp) &&
    !Buffer.isBuffer(value) &&
    !(value instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(value)
  );
}

function checksumGraphShape(
  roots: RuntimeAdapterRoot[],
  objects: RuntimeAdapterObjectNode[],
): string {
  const text = JSON.stringify({ roots, objects });
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(text, "utf8")) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `0x${hash.toString(16)}`;
}

function unsupported(refusals: RuntimeAdapterRefusal[]): RuntimeAdapterUnsupportedVocabulary {
  return { vocabularyVersion: 1, refusals };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

function hostArch(): "arm64" | "amd64" {
  return globalThis.process?.arch === "x64" ? "amd64" : "arm64";
}

function nodeVersion(): string {
  return globalThis.process?.versions?.node ?? "unknown";
}

function nodeV8Version(): string {
  return globalThis.process?.versions?.v8 ?? "unknown";
}

function assertNeverValueKind(value: never): never {
  throw new Error(`unsupported runtime adapter value kind: ${JSON.stringify(value)}`);
}

function assertNeverObjectKind(kind: never): never {
  throw new Error(`unsupported runtime adapter object kind: ${kind}`);
}

export type NodeRuntimeAdapterResourceKind = RuntimeAdapterResourceKind;
