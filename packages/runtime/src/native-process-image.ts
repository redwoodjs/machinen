/**
 * Transparent native cross-ISA process image contract.
 *
 * This format describes an externally captured Linux process that will be
 * translated into a target-native process. It intentionally separates raw
 * source-ISA capture data from target-ISA materialization plans so a restore
 * implementation cannot accidentally treat source registers, stacks, or mapping
 * addresses as directly reusable target state.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const NATIVE_PROCESS_IMAGE_FORMAT_VERSION = 1;

export const NATIVE_PROCESS_IMAGE_FILES = {
  manifest: "native-process.json",
  mappings: "native-mappings.json",
  threads: "native-threads.json",
  resources: "native-resources.json",
  translation: "native-translation.json",
  memory: "native-memory.bin",
} as const;

export const nativeProcessImageArchitectures = ["arm64", "amd64"] as const;
export type NativeProcessImageArchitecture = (typeof nativeProcessImageArchitectures)[number];

export const nativeProcessImageRefusalCodes = [
  "active-syscall",
  "architecture-pair-unsupported",
  "architecture-unsupported",
  "blocking-syscall-state-unsupported",
  "code-location-unknown",
  "cross-isa-vmstate-restore-unsupported",
  "fd-kind-unsupported",
  "futex-state-unsupported",
  "inherited-stdio-policy-required",
  "kernel-state-unsupported",
  "mapping-ambiguous",
  "mapping-captured-range-unsupported",
  "mapping-executable-unsupported",
  "mapping-permission-unsupported",
  "mapping-provenance-ambiguous",
  "mapping-shared-unsupported",
  "mapping-unreadable",
  "pointer-ambiguous",
  "proof-arch-pair-unsupported",
  "resource-kind-unsupported",
  "non-stdio-kernel-state-unsupported",
  "rseq-state-unsupported",
  "signal-frame-active",
  "signal-state-unsupported",
  "simd-fpu-state-unsupported",
  "stdin-buffer-state-unsupported",
  "syscall-argument-state-unsupported",
  "syscall-restart-unsupported",
  "target-build-id-mismatch",
  "target-build-mismatch",
  "target-code-location-unresolved",
  "target-callee-saved-state-unsupported",
  "target-caller-frame-unavailable",
  "target-code-rva-unmapped",
  "target-code-outside-portable-bundle",
  "target-epoll-syscall-state-unsupported",
  "target-fd-table-duplicate",
  "target-fd-read-state-missing",
  "target-fd-write-state-missing",
  "target-fd-table-missing",
  "target-frame-layout-unsupported",
  "target-frame-register-value-unavailable",
  "target-module-bytes-missing",
  "target-module-file-missing",
  "target-module-missing",
  "target-module-not-executable",
  "target-module-range-unreadable",
  "target-ppoll-syscall-continuation-missing",
  "target-ppoll-timeout-missing",
  "target-process-context-unsupported",
  "target-return-slot-unsupported",
  "target-signalfd-state-unsupported",
  "target-resume-execution-unavailable",
  "target-resume-fault-invalid-code-landing",
  "target-resume-fault-outside-target-bytes",
  "target-resume-fault-privileged-instruction",
  "target-resume-fault-signal-unsupported",
  "target-resume-fault-timeout",
  "target-resume-fault-unmodeled-memory",
  "target-semantic-continuation-missing",
  "target-sleep-remaining-time-missing",
  "target-socket-syscall-state-unsupported",
  "target-sleep-signal-restart-unsupported",
  "target-sleep-syscall-continuation-missing",
  "target-stack-window-unsupported",
  "target-synthetic-signal-interrupted-unsupported",
  "target-synthetic-signal-restart-unsupported",
  "target-synthetic-syscall-return-unmodeled",
  "thread-state-unsupported",
  "tls-state-unsupported",
  "return-slot-unreadable",
  "target-unwind-mismatch",
  "unwind-fde-missing",
  "unwind-metadata-missing",
  "unwind-rule-unsupported",
  "vdso-policy-unsupported",
] as const;
export type NativeProcessImageRefusalCode = (typeof nativeProcessImageRefusalCodes)[number];

export interface NativeProcessImageRefusal {
  code: NativeProcessImageRefusalCode;
  message: string;
  detail?: Record<string, unknown>;
}

export interface NativeProcessImageRefusals {
  vocabularyVersion: 1;
  refusals: NativeProcessImageRefusal[];
}

export interface NativeProcessImageManifest {
  formatVersion: 1;
  kind: "machinen.native-process-image";
  capture: {
    method: "external-ptrace-procfs";
    sourceArch: NativeProcessImageArchitecture;
    pid?: number;
    capturedAt?: string;
  };
  target: {
    mode: "native-cross-isa";
    arch: NativeProcessImageArchitecture;
    abi: "linux-user";
  };
  process: {
    exe: string;
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  };
  refusals: NativeProcessImageRefusals;
}

export type NativeMemoryMappingKind =
  | "text"
  | "data"
  | "heap"
  | "stack"
  | "tls"
  | "vdso"
  | "vvar"
  | "file"
  | "anonymous"
  | "shared"
  | "special";

export interface NativeMemoryMapping {
  id: string;
  kind: NativeMemoryMappingKind;
  sourceStart: string;
  sourceEnd: string;
  sizeBytes: number;
  permissions: {
    read: boolean;
    write: boolean;
    execute: boolean;
    private: boolean;
    shared: boolean;
  };
  file?: {
    path: string;
    offset: number;
    buildId?: string;
    sha256?: string;
  };
  captured?: {
    file: typeof NATIVE_PROCESS_IMAGE_FILES.memory;
    offset: number;
    sizeBytes: number;
  };
  target: {
    materialization: "translate" | "recreate" | "omit" | "refuse";
    targetStart?: string;
    reason?: string;
  };
  refusal?: NativeProcessImageRefusal;
}

export interface NativeProcessImageMappings {
  formatVersion: 1;
  mappings: NativeMemoryMapping[];
  refusals: NativeProcessImageRefusals;
}

export interface NativeArm64Registers {
  arch: "arm64";
  pc: string;
  sp: string;
  pstate: string;
  x: string[];
}

export interface NativeAmd64Registers {
  arch: "amd64";
  rip: string;
  rsp: string;
  rflags: string;
  rax: string;
  rbx: string;
  rcx: string;
  rdx: string;
  rsi: string;
  rdi: string;
  rbp: string;
  r8: string;
  r9: string;
  r10: string;
  r11: string;
  r12: string;
  r13: string;
  r14: string;
  r15: string;
  fsBase: string;
  gsBase: string;
}

export type NativeRegisterState = NativeArm64Registers | NativeAmd64Registers;

export type NativeTlsThreadPointerRegister = "arm64-tpidr-el0" | "amd64-fs-base";

export type NativeTlsAmd64SegmentBases =
  | {
      state: "not-required";
      fsBase: string;
      gsBase: string;
      reason?: string;
    }
  | {
      state: "provided";
      fsBase: string;
      gsBase: string;
      provenance?: string;
    }
  | { state: "unsupported"; reason?: string; refusal?: NativeProcessImageRefusal };

export type NativeSimdFpuLiveSubset =
  | "fp-control-state"
  | "caller-saved-vector-registers"
  | "callee-saved-vector-registers"
  | "unknown-live-state";

export type NativeSimdFpuState =
  | { state: "not-live"; provenance?: string }
  | {
      state: "requires-restore";
      arch?: NativeProcessImageArchitecture;
      byteLength?: number;
      liveSubset?: NativeSimdFpuLiveSubset;
      reason?: string;
    }
  | { state: "not-captured" | "unsupported"; reason?: string; refusal?: NativeProcessImageRefusal };

export interface NativeThreadState {
  id: string;
  lwpid?: number;
  state: "stopped";
  stopReason: "ptrace-stop" | "signal-delivery-stop" | "group-stop";
  stackMapping: string;
  sourceRegisters: NativeRegisterState;
  syscall: {
    state: "outside-syscall" | "inside-syscall" | "restart-block";
    number?: number;
    name?: string;
    arguments?: string[];
    stackPointer?: string;
    instructionPointer?: string;
  };
  signal: {
    blocked: string[];
    pending: string[];
    activeFrame: boolean;
    altStack: {
      state: "disabled" | "enabled" | "unsupported";
      sp?: string;
      sizeBytes?: number;
      refusal?: NativeProcessImageRefusal;
    };
  };
  tls: {
    threadPointer: string;
    sourceRegister?: NativeTlsThreadPointerRegister;
    targetSegmentBases?: NativeTlsAmd64SegmentBases;
    rseq: {
      state: "absent" | "captured" | "unsupported";
      refusal?: NativeProcessImageRefusal;
    };
  };
  simdFpu?: NativeSimdFpuState;
  refusal?: NativeProcessImageRefusal;
}

export interface NativeProcessImageThreads {
  formatVersion: 1;
  threads: NativeThreadState[];
  refusals: NativeProcessImageRefusals;
}

export type NativeProcessResourceKind =
  | "argv"
  | "env"
  | "cwd"
  | "exe"
  | "auxv"
  | "fd"
  | "file"
  | "pipe"
  | "socket"
  | "raw-socket"
  | "pty"
  | "timer"
  | "eventfd"
  | "signal"
  | "signalfd"
  | "namespace"
  | "credential"
  | "futex"
  | "epoll"
  | "unknown";

export interface NativeProcessResource {
  id: string;
  kind: NativeProcessResourceKind;
  state: "captured" | "recipe" | "refused" | "unsupported";
  fd?: number;
  path?: string;
  flags?: string[];
  offset?: number;
  recipe?: Record<string, unknown>;
  refusal?: NativeProcessImageRefusal;
}

export interface NativeProcessImageResources {
  formatVersion: 1;
  resources: NativeProcessResource[];
  refusals: NativeProcessImageRefusals;
}

export interface NativeCodeLocationMapping {
  id: string;
  sourceMapping: string;
  sourceAddress: string;
  targetAddress?: string;
  state: "mapped" | "pending" | "refused";
  refusal?: NativeProcessImageRefusal;
}

export interface NativeThreadTranslation {
  sourceThreadId: string;
  state: "pending" | "translated" | "refused";
  targetRegisters?: NativeRegisterState;
  refusal?: NativeProcessImageRefusal;
}

export interface NativeMemoryRelocation {
  mapping: string;
  offset: number;
  kind: "pointer" | "code-pointer" | "return-address" | "thread-pointer";
  sourceValue: string;
  targetValue?: string;
  state: "translated" | "ambiguous" | "refused";
  refusal?: NativeProcessImageRefusal;
}

export interface NativeProcessImageTranslation {
  formatVersion: 1;
  mode: "native-cross-isa";
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  codeLocations: NativeCodeLocationMapping[];
  threads: NativeThreadTranslation[];
  memoryRelocations: NativeMemoryRelocation[];
  refusals: NativeProcessImageRefusals;
}

export interface NativeProcessImageDocuments {
  rootDir?: string;
  manifest: NativeProcessImageManifest;
  mappings: NativeProcessImageMappings;
  threads: NativeProcessImageThreads;
  resources: NativeProcessImageResources;
  translation: NativeProcessImageTranslation;
}

export interface NativeProcessImageDocumentInput {
  rootDir?: string;
  manifest: unknown;
  mappings: unknown;
  threads: unknown;
  resources: unknown;
  translation: unknown;
}

export type NativeProcessImageJsonSchema = Record<string, unknown>;

const REFUSAL_SCHEMA: NativeProcessImageJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: { enum: nativeProcessImageRefusalCodes },
    message: { type: "string", minLength: 1 },
    detail: { type: "object" },
  },
};

const REFUSALS_SCHEMA: NativeProcessImageJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["vocabularyVersion", "refusals"],
  properties: {
    vocabularyVersion: { const: 1 },
    refusals: { type: "array", items: REFUSAL_SCHEMA },
  },
};

export const nativeProcessImageSchemas = {
  manifest: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://machinen.dev/schemas/native-process-image/manifest.schema.json",
    title: "Machinen native process image manifest",
    type: "object",
    additionalProperties: false,
    required: ["formatVersion", "kind", "capture", "target", "process", "refusals"],
    properties: {
      formatVersion: { const: NATIVE_PROCESS_IMAGE_FORMAT_VERSION },
      kind: { const: "machinen.native-process-image" },
      capture: {
        type: "object",
        additionalProperties: false,
        required: ["method", "sourceArch"],
        properties: {
          method: { const: "external-ptrace-procfs" },
          sourceArch: { enum: nativeProcessImageArchitectures },
          pid: { type: "integer", minimum: 1 },
          capturedAt: { type: "string" },
        },
      },
      target: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "arch", "abi"],
        properties: {
          mode: { const: "native-cross-isa" },
          arch: { enum: nativeProcessImageArchitectures },
          abi: { const: "linux-user" },
        },
      },
      process: {
        type: "object",
        additionalProperties: false,
        required: ["exe", "argv", "env", "cwd"],
        properties: {
          exe: { type: "string", minLength: 1 },
          argv: { type: "array", items: { type: "string" }, minItems: 1 },
          env: { type: "object", additionalProperties: { type: "string" } },
          cwd: { type: "string", minLength: 1 },
        },
      },
      refusals: REFUSALS_SCHEMA,
    },
  },
  mappings: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://machinen.dev/schemas/native-process-image/mappings.schema.json",
    title: "Machinen native process image mappings",
    type: "object",
    additionalProperties: false,
    required: ["formatVersion", "mappings", "refusals"],
    properties: {
      formatVersion: { const: NATIVE_PROCESS_IMAGE_FORMAT_VERSION },
      mappings: { type: "array" },
      refusals: REFUSALS_SCHEMA,
    },
  },
  threads: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://machinen.dev/schemas/native-process-image/threads.schema.json",
    title: "Machinen native process image threads",
    type: "object",
    additionalProperties: false,
    required: ["formatVersion", "threads", "refusals"],
    properties: {
      formatVersion: { const: NATIVE_PROCESS_IMAGE_FORMAT_VERSION },
      threads: { type: "array", minItems: 1 },
      refusals: REFUSALS_SCHEMA,
    },
  },
  resources: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://machinen.dev/schemas/native-process-image/resources.schema.json",
    title: "Machinen native process image resources",
    type: "object",
    additionalProperties: false,
    required: ["formatVersion", "resources", "refusals"],
    properties: {
      formatVersion: { const: NATIVE_PROCESS_IMAGE_FORMAT_VERSION },
      resources: { type: "array" },
      refusals: REFUSALS_SCHEMA,
    },
  },
  translation: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://machinen.dev/schemas/native-process-image/translation.schema.json",
    title: "Machinen native process image translation plan",
    type: "object",
    additionalProperties: false,
    required: [
      "formatVersion",
      "mode",
      "sourceArch",
      "targetArch",
      "codeLocations",
      "threads",
      "memoryRelocations",
      "refusals",
    ],
    properties: {
      formatVersion: { const: NATIVE_PROCESS_IMAGE_FORMAT_VERSION },
      mode: { const: "native-cross-isa" },
      sourceArch: { enum: nativeProcessImageArchitectures },
      targetArch: { enum: nativeProcessImageArchitectures },
      codeLocations: { type: "array" },
      threads: { type: "array" },
      memoryRelocations: { type: "array" },
      refusals: REFUSALS_SCHEMA,
    },
  },
} as const;

export class NativeProcessImageValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(
      ["native process image validation failed:", ...errors.map((error) => `  - ${error}`)].join(
        "\n",
      ),
    );
    this.name = "NativeProcessImageValidationError";
    this.errors = errors;
  }
}

export function isNativeProcessImageBundle(dir: string): boolean {
  return existsSync(join(resolve(dir), NATIVE_PROCESS_IMAGE_FILES.manifest));
}

export function validateNativeProcessImageBundle(dir: string): NativeProcessImageDocuments {
  const rootDir = resolve(dir);
  const docs: NativeProcessImageDocuments = {
    rootDir,
    manifest: readNativeProcessJson(rootDir, NATIVE_PROCESS_IMAGE_FILES.manifest),
    mappings: readNativeProcessJson(rootDir, NATIVE_PROCESS_IMAGE_FILES.mappings),
    threads: readNativeProcessJson(rootDir, NATIVE_PROCESS_IMAGE_FILES.threads),
    resources: readNativeProcessJson(rootDir, NATIVE_PROCESS_IMAGE_FILES.resources),
    translation: readNativeProcessJson(rootDir, NATIVE_PROCESS_IMAGE_FILES.translation),
  } as NativeProcessImageDocuments;
  assertNativeProcessImageDocuments(docs, { rootDir });
  return docs;
}

export function validateNativeProcessImageDocuments(
  docs: NativeProcessImageDocumentInput,
  opts: { rootDir?: string } = {},
): string[] {
  const ctx = newNativeValidationContext(opts.rootDir);
  validateNativeManifest(ctx, docs.manifest);
  validateNativeMappings(ctx, docs.mappings);
  validateNativeThreads(ctx, docs.threads, docs.manifest, docs.mappings);
  validateNativeResources(ctx, docs.resources);
  validateNativeTranslation(ctx, docs.translation, docs.manifest, docs.mappings, docs.threads);
  validateNativeBundleFiles(ctx);
  return ctx.errors;
}

export function assertNativeProcessImageDocuments(
  docs: NativeProcessImageDocumentInput,
  opts: { rootDir?: string } = {},
): asserts docs is NativeProcessImageDocuments {
  const errors = validateNativeProcessImageDocuments(docs, opts);
  if (errors.length > 0) {
    throw new NativeProcessImageValidationError(errors);
  }
}

function readNativeProcessJson(rootDir: string, name: string): unknown {
  const file = join(rootDir, name);
  if (!existsSync(file)) {
    throw new NativeProcessImageValidationError([`${name} is missing`]);
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new NativeProcessImageValidationError([`${name} is not valid JSON: ${reason}`]);
  }
}

interface NativeValidationContext {
  rootDir?: string;
  errors: string[];
}

function newNativeValidationContext(rootDir: string | undefined): NativeValidationContext {
  return { rootDir, errors: [] };
}

function validateNativeManifest(ctx: NativeValidationContext, doc: unknown): void {
  const manifest = nativeRecord(ctx, "manifest", doc);
  if (!manifest) {
    return;
  }
  nativeVersion(ctx, "manifest.formatVersion", manifest.formatVersion);
  nativeEquals(ctx, "manifest.kind", manifest.kind, "machinen.native-process-image");
  validateCapture(ctx, manifest.capture);
  validateTarget(ctx, manifest.target, manifest.capture);
  validateNativeProcess(ctx, manifest.process);
  validateNativeRefusals(ctx, "manifest.refusals", manifest.refusals);
}

function validateCapture(ctx: NativeValidationContext, value: unknown): void {
  const capture = nativeRecord(ctx, "manifest.capture", value);
  if (!capture) {
    return;
  }
  nativeEquals(ctx, "manifest.capture.method", capture.method, "external-ptrace-procfs");
  nativeArch(ctx, "manifest.capture.sourceArch", capture.sourceArch);
  nativeOptionalPositiveInt(ctx, "manifest.capture.pid", capture.pid);
  nativeOptionalString(ctx, "manifest.capture.capturedAt", capture.capturedAt);
}

function validateTarget(ctx: NativeValidationContext, value: unknown, captureValue: unknown): void {
  const target = nativeRecord(ctx, "manifest.target", value);
  if (!target) {
    return;
  }
  nativeEquals(ctx, "manifest.target.mode", target.mode, "native-cross-isa");
  nativeArch(ctx, "manifest.target.arch", target.arch);
  nativeEquals(ctx, "manifest.target.abi", target.abi, "linux-user");
  const sourceArch = nativeRecordValue(captureValue)?.sourceArch;
  if (typeof sourceArch === "string" && sourceArch === target.arch) {
    ctx.errors.push("manifest.target.arch must differ from manifest.capture.sourceArch");
  }
}

function validateNativeProcess(ctx: NativeValidationContext, value: unknown): void {
  const process = nativeRecord(ctx, "manifest.process", value);
  if (!process) {
    return;
  }
  nativeAbsolutePath(ctx, "manifest.process.exe", process.exe);
  nativeStringArray(ctx, "manifest.process.argv", process.argv, { minItems: 1 });
  nativeStringRecord(ctx, "manifest.process.env", process.env);
  nativeAbsolutePath(ctx, "manifest.process.cwd", process.cwd);
}

function validateNativeMappings(ctx: NativeValidationContext, doc: unknown): void {
  const mappings = nativeRecord(ctx, "mappings", doc);
  if (!mappings) {
    return;
  }
  nativeVersion(ctx, "mappings.formatVersion", mappings.formatVersion);
  const entries = nativeArray(ctx, "mappings.mappings", mappings.mappings);
  if (entries) {
    const seen = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      validateMappingEntry(ctx, `mappings.mappings[${index}]`, entry, seen);
    }
  }
  validateNativeRefusals(ctx, "mappings.refusals", mappings.refusals);
}

function validateMappingEntry(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  seen: Set<string>,
): void {
  const mapping = nativeRecord(ctx, path, value);
  if (!mapping) {
    return;
  }
  validateUniqueId(ctx, `${path}.id`, mapping.id, seen);
  nativeEnum(ctx, `${path}.kind`, mapping.kind, MEMORY_MAPPING_KINDS);
  nativeHex(ctx, `${path}.sourceStart`, mapping.sourceStart);
  nativeHex(ctx, `${path}.sourceEnd`, mapping.sourceEnd);
  nativeNonNegativeInt(ctx, `${path}.sizeBytes`, mapping.sizeBytes);
  validatePermissions(ctx, `${path}.permissions`, mapping.permissions);
  validateMappingFile(ctx, `${path}.file`, mapping.file);
  validateCapturedMemory(ctx, `${path}.captured`, mapping.captured);
  validateTargetMaterialization(ctx, `${path}.target`, mapping.target, mapping.kind);
  if (mapping.refusal !== undefined) {
    validateNativeRefusal(ctx, `${path}.refusal`, mapping.refusal);
  }
}

function validatePermissions(ctx: NativeValidationContext, path: string, value: unknown): void {
  const perms = nativeRecord(ctx, path, value);
  if (!perms) {
    return;
  }
  nativeBoolean(ctx, `${path}.read`, perms.read);
  nativeBoolean(ctx, `${path}.write`, perms.write);
  nativeBoolean(ctx, `${path}.execute`, perms.execute);
  nativeBoolean(ctx, `${path}.private`, perms.private);
  nativeBoolean(ctx, `${path}.shared`, perms.shared);
  if (perms.private === true && perms.shared === true) {
    ctx.errors.push(`${path} cannot be both private and shared`);
  }
}

function validateMappingFile(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  const file = nativeRecord(ctx, path, value);
  if (!file) {
    return;
  }
  nativeAbsolutePath(ctx, `${path}.path`, file.path);
  nativeNonNegativeInt(ctx, `${path}.offset`, file.offset);
  nativeOptionalBuildId(ctx, `${path}.buildId`, file.buildId);
  nativeOptionalSha256(ctx, `${path}.sha256`, file.sha256);
}

function validateCapturedMemory(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  const captured = nativeRecord(ctx, path, value);
  if (!captured) {
    return;
  }
  nativeEquals(ctx, `${path}.file`, captured.file, NATIVE_PROCESS_IMAGE_FILES.memory);
  nativeNonNegativeInt(ctx, `${path}.offset`, captured.offset);
  nativeNonNegativeInt(ctx, `${path}.sizeBytes`, captured.sizeBytes);
}

function validateTargetMaterialization(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  mappingKind: unknown,
): void {
  const target = nativeRecord(ctx, path, value);
  if (!target) {
    return;
  }
  nativeEnum(ctx, `${path}.materialization`, target.materialization, TARGET_MATERIALIZATIONS);
  nativeOptionalHex(ctx, `${path}.targetStart`, target.targetStart);
  nativeOptionalString(ctx, `${path}.reason`, target.reason);
  if (isKernelMappingKind(mappingKind) && target.materialization === "translate") {
    ctx.errors.push(`${path}.materialization must recreate, omit, or refuse kernel mappings`);
  }
}

function validateNativeThreads(
  ctx: NativeValidationContext,
  doc: unknown,
  manifestDoc: unknown,
  mappingsDoc: unknown,
): void {
  const threadsDoc = nativeRecord(ctx, "threads", doc);
  if (!threadsDoc) {
    return;
  }
  nativeVersion(ctx, "threads.formatVersion", threadsDoc.formatVersion);
  const threads = nativeArray(ctx, "threads.threads", threadsDoc.threads, { minItems: 1 });
  if (threads) {
    const seen = new Set<string>();
    const mappingIds = collectMappingIds(mappingsDoc);
    const sourceArch = manifestSourceArch(manifestDoc);
    for (const [index, thread] of threads.entries()) {
      validateThreadEntry(ctx, `threads.threads[${index}]`, thread, seen, mappingIds, sourceArch);
    }
  }
  validateNativeRefusals(ctx, "threads.refusals", threadsDoc.refusals);
}

function validateThreadEntry(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  seen: Set<string>,
  mappingIds: Set<string>,
  sourceArch: string | undefined,
): void {
  const thread = nativeRecord(ctx, path, value);
  if (!thread) {
    return;
  }
  validateUniqueId(ctx, `${path}.id`, thread.id, seen);
  nativeOptionalPositiveInt(ctx, `${path}.lwpid`, thread.lwpid);
  nativeEquals(ctx, `${path}.state`, thread.state, "stopped");
  nativeEnum(ctx, `${path}.stopReason`, thread.stopReason, THREAD_STOP_REASONS);
  validateMappingRef(ctx, `${path}.stackMapping`, thread.stackMapping, mappingIds);
  validateSourceRegisters(ctx, `${path}.sourceRegisters`, thread.sourceRegisters, sourceArch);
  validateThreadSyscall(ctx, `${path}.syscall`, thread.syscall);
  validateThreadSignal(ctx, `${path}.signal`, thread.signal);
  validateThreadTls(ctx, `${path}.tls`, thread.tls);
  validateThreadSimdFpu(ctx, `${path}.simdFpu`, thread.simdFpu);
  if (thread.refusal !== undefined) {
    validateNativeRefusal(ctx, `${path}.refusal`, thread.refusal);
  }
}

function validateSourceRegisters(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  sourceArch: string | undefined,
): void {
  const registers = nativeRecord(ctx, path, value);
  if (!registers) {
    return;
  }
  nativeArch(ctx, `${path}.arch`, registers.arch);
  if (sourceArch && registers.arch !== sourceArch) {
    ctx.errors.push(`${path}.arch must match manifest.capture.sourceArch`);
  }
  if (registers.arch === "arm64") {
    validateArm64Registers(ctx, path, registers);
  } else if (registers.arch === "amd64") {
    validateAmd64Registers(ctx, path, registers);
  }
}

function validateArm64Registers(
  ctx: NativeValidationContext,
  path: string,
  registers: Record<string, unknown>,
): void {
  nativeHex(ctx, `${path}.pc`, registers.pc);
  nativeHex(ctx, `${path}.sp`, registers.sp);
  nativeHex(ctx, `${path}.pstate`, registers.pstate);
  const x = nativeArray(ctx, `${path}.x`, registers.x, { exactItems: 31 });
  if (!x) {
    return;
  }
  for (const [index, value] of x.entries()) {
    nativeHex(ctx, `${path}.x[${index}]`, value);
  }
}

function validateAmd64Registers(
  ctx: NativeValidationContext,
  path: string,
  registers: Record<string, unknown>,
): void {
  for (const register of AMD64_REGISTER_FIELDS) {
    nativeHex(ctx, `${path}.${register}`, registers[register]);
  }
}

function validateThreadSyscall(ctx: NativeValidationContext, path: string, value: unknown): void {
  const syscall = nativeRecord(ctx, path, value);
  if (!syscall) {
    return;
  }
  nativeEnum(ctx, `${path}.state`, syscall.state, SYSCALL_STATES);
  nativeOptionalNonNegativeInt(ctx, `${path}.number`, syscall.number);
  nativeOptionalString(ctx, `${path}.name`, syscall.name);
  validateThreadSyscallArguments(ctx, path, syscall.arguments);
  nativeOptionalHex(ctx, `${path}.stackPointer`, syscall.stackPointer);
  nativeOptionalHex(ctx, `${path}.instructionPointer`, syscall.instructionPointer);
}

function validateThreadSyscallArguments(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }
  const args = nativeArray(ctx, `${path}.arguments`, value, { exactItems: 6 });
  if (!args) {
    return;
  }
  for (const [index, arg] of args.entries()) {
    nativeHex(ctx, `${path}.arguments[${index}]`, arg);
  }
}

function validateThreadSignal(ctx: NativeValidationContext, path: string, value: unknown): void {
  const signal = nativeRecord(ctx, path, value);
  if (!signal) {
    return;
  }
  nativeStringArray(ctx, `${path}.blocked`, signal.blocked);
  nativeStringArray(ctx, `${path}.pending`, signal.pending);
  nativeBoolean(ctx, `${path}.activeFrame`, signal.activeFrame);
  validateAltStack(ctx, `${path}.altStack`, signal.altStack);
}

function validateAltStack(ctx: NativeValidationContext, path: string, value: unknown): void {
  const altStack = nativeRecord(ctx, path, value);
  if (!altStack) {
    return;
  }
  nativeEnum(ctx, `${path}.state`, altStack.state, ALT_STACK_STATES);
  nativeOptionalHex(ctx, `${path}.sp`, altStack.sp);
  nativeOptionalNonNegativeInt(ctx, `${path}.sizeBytes`, altStack.sizeBytes);
  if (altStack.refusal !== undefined) {
    validateNativeRefusal(ctx, `${path}.refusal`, altStack.refusal);
  }
}

function validateThreadTls(ctx: NativeValidationContext, path: string, value: unknown): void {
  const tls = nativeRecord(ctx, path, value);
  if (!tls) {
    return;
  }
  nativeHex(ctx, `${path}.threadPointer`, tls.threadPointer);
  if (tls.sourceRegister !== undefined) {
    nativeEnum(ctx, `${path}.sourceRegister`, tls.sourceRegister, TLS_THREAD_POINTER_REGISTERS);
  }
  validateThreadTargetSegmentBases(ctx, `${path}.targetSegmentBases`, tls.targetSegmentBases);
  const rseq = nativeRecord(ctx, `${path}.rseq`, tls.rseq);
  if (!rseq) {
    return;
  }
  nativeEnum(ctx, `${path}.rseq.state`, rseq.state, RSEQ_STATES);
  if (rseq.refusal !== undefined) {
    validateNativeRefusal(ctx, `${path}.rseq.refusal`, rseq.refusal);
  }
}

function validateThreadTargetSegmentBases(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }
  const bases = nativeRecord(ctx, path, value);
  if (!bases) {
    return;
  }
  nativeEnum(ctx, `${path}.state`, bases.state, TLS_TARGET_SEGMENT_BASE_STATES);
  if (bases.state !== "unsupported") {
    nativeHex(ctx, `${path}.fsBase`, bases.fsBase);
    nativeHex(ctx, `${path}.gsBase`, bases.gsBase);
  }
  nativeOptionalString(ctx, `${path}.reason`, bases.reason);
  nativeOptionalString(ctx, `${path}.provenance`, bases.provenance);
  if (bases.refusal !== undefined) {
    validateNativeRefusal(ctx, `${path}.refusal`, bases.refusal);
  }
}

function validateThreadSimdFpu(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  const simdFpu = nativeRecord(ctx, path, value);
  if (!simdFpu) {
    return;
  }
  nativeEnum(ctx, `${path}.state`, simdFpu.state, SIMD_FPU_STATES);
  nativeOptionalString(ctx, `${path}.provenance`, simdFpu.provenance);
  nativeOptionalString(ctx, `${path}.reason`, simdFpu.reason);
  if (simdFpu.liveSubset !== undefined) {
    nativeEnum(ctx, `${path}.liveSubset`, simdFpu.liveSubset, SIMD_FPU_LIVE_SUBSETS);
  }
  if (simdFpu.arch !== undefined) {
    nativeArch(ctx, `${path}.arch`, simdFpu.arch);
  }
  nativeOptionalNonNegativeInt(ctx, `${path}.byteLength`, simdFpu.byteLength);
  if (simdFpu.refusal !== undefined) {
    validateNativeRefusal(ctx, `${path}.refusal`, simdFpu.refusal);
  }
}

function validateNativeResources(ctx: NativeValidationContext, doc: unknown): void {
  const resourcesDoc = nativeRecord(ctx, "resources", doc);
  if (!resourcesDoc) {
    return;
  }
  nativeVersion(ctx, "resources.formatVersion", resourcesDoc.formatVersion);
  const resources = nativeArray(ctx, "resources.resources", resourcesDoc.resources);
  if (resources) {
    const seen = new Set<string>();
    for (const [index, resource] of resources.entries()) {
      validateResourceEntry(ctx, `resources.resources[${index}]`, resource, seen);
    }
  }
  validateNativeRefusals(ctx, "resources.refusals", resourcesDoc.refusals);
}

function validateResourceEntry(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  seen: Set<string>,
): void {
  const resource = nativeRecord(ctx, path, value);
  if (!resource) {
    return;
  }
  validateUniqueId(ctx, `${path}.id`, resource.id, seen);
  nativeEnum(ctx, `${path}.kind`, resource.kind, RESOURCE_KINDS);
  nativeEnum(ctx, `${path}.state`, resource.state, RESOURCE_STATES);
  nativeOptionalNonNegativeInt(ctx, `${path}.fd`, resource.fd);
  nativeOptionalString(ctx, `${path}.path`, resource.path);
  nativeStringArray(ctx, `${path}.flags`, resource.flags ?? []);
  nativeOptionalNonNegativeInt(ctx, `${path}.offset`, resource.offset);
  if (resource.recipe !== undefined && !nativeRecordValue(resource.recipe)) {
    ctx.errors.push(`${path}.recipe must be an object`);
  }
  if (resource.refusal !== undefined) {
    validateNativeRefusal(ctx, `${path}.refusal`, resource.refusal);
  }
  if ((resource.state === "refused" || resource.state === "unsupported") && !resource.refusal) {
    ctx.errors.push(`${path}.refusal is required when state is ${String(resource.state)}`);
  }
}

function validateNativeTranslation(
  ctx: NativeValidationContext,
  doc: unknown,
  manifestDoc: unknown,
  mappingsDoc: unknown,
  threadsDoc: unknown,
): void {
  const translation = nativeRecord(ctx, "translation", doc);
  if (!translation) {
    return;
  }
  nativeVersion(ctx, "translation.formatVersion", translation.formatVersion);
  nativeEquals(ctx, "translation.mode", translation.mode, "native-cross-isa");
  validateTranslationArchs(ctx, translation, manifestDoc);
  validateCodeLocations(ctx, translation.codeLocations, collectMappingIds(mappingsDoc));
  validateThreadTranslations(
    ctx,
    translation.threads,
    collectThreadIds(threadsDoc),
    translation.targetArch,
  );
  validateMemoryRelocations(ctx, translation.memoryRelocations, collectMappingIds(mappingsDoc));
  validateNativeRefusals(ctx, "translation.refusals", translation.refusals);
}

function validateTranslationArchs(
  ctx: NativeValidationContext,
  translation: Record<string, unknown>,
  manifestDoc: unknown,
): void {
  nativeArch(ctx, "translation.sourceArch", translation.sourceArch);
  nativeArch(ctx, "translation.targetArch", translation.targetArch);
  if (translation.sourceArch === translation.targetArch) {
    ctx.errors.push("translation.targetArch must differ from translation.sourceArch");
  }
  const sourceArch = manifestSourceArch(manifestDoc);
  const targetArch = manifestTargetArch(manifestDoc);
  if (sourceArch && translation.sourceArch !== sourceArch) {
    ctx.errors.push("translation.sourceArch must match manifest.capture.sourceArch");
  }
  if (targetArch && translation.targetArch !== targetArch) {
    ctx.errors.push("translation.targetArch must match manifest.target.arch");
  }
}

function validateCodeLocations(
  ctx: NativeValidationContext,
  value: unknown,
  mappingIds: Set<string>,
): void {
  const locations = nativeArray(ctx, "translation.codeLocations", value);
  if (!locations) {
    return;
  }
  const seen = new Set<string>();
  for (const [index, value] of locations.entries()) {
    const path = `translation.codeLocations[${index}]`;
    const location = nativeRecord(ctx, path, value);
    if (!location) {
      continue;
    }
    validateUniqueId(ctx, `${path}.id`, location.id, seen);
    validateMappingRef(ctx, `${path}.sourceMapping`, location.sourceMapping, mappingIds);
    nativeHex(ctx, `${path}.sourceAddress`, location.sourceAddress);
    nativeOptionalHex(ctx, `${path}.targetAddress`, location.targetAddress);
    nativeEnum(ctx, `${path}.state`, location.state, TRANSLATION_STATES);
    if (location.refusal !== undefined) {
      validateNativeRefusal(ctx, `${path}.refusal`, location.refusal);
    }
  }
}

function validateThreadTranslations(
  ctx: NativeValidationContext,
  value: unknown,
  threadIds: Set<string>,
  targetArch: unknown,
): void {
  const translations = nativeArray(ctx, "translation.threads", value);
  if (!translations) {
    return;
  }
  for (const [index, value] of translations.entries()) {
    const path = `translation.threads[${index}]`;
    const translation = nativeRecord(ctx, path, value);
    if (!translation) {
      continue;
    }
    validateThreadRef(ctx, `${path}.sourceThreadId`, translation.sourceThreadId, threadIds);
    nativeEnum(ctx, `${path}.state`, translation.state, THREAD_TRANSLATION_STATES);
    validateTargetRegisters(
      ctx,
      `${path}.targetRegisters`,
      translation.targetRegisters,
      targetArch,
    );
    if (translation.refusal !== undefined) {
      validateNativeRefusal(ctx, `${path}.refusal`, translation.refusal);
    }
    if (translation.state === "translated" && translation.targetRegisters === undefined) {
      ctx.errors.push(`${path}.targetRegisters is required when state is translated`);
    }
    if (translation.state === "refused" && translation.refusal === undefined) {
      ctx.errors.push(`${path}.refusal is required when state is refused`);
    }
  }
}

function validateTargetRegisters(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  targetArch: unknown,
): void {
  if (value === undefined) {
    return;
  }
  validateSourceRegisters(
    ctx,
    path,
    value,
    typeof targetArch === "string" ? targetArch : undefined,
  );
}

function validateMemoryRelocations(
  ctx: NativeValidationContext,
  value: unknown,
  mappingIds: Set<string>,
): void {
  const relocations = nativeArray(ctx, "translation.memoryRelocations", value);
  if (!relocations) {
    return;
  }
  for (const [index, value] of relocations.entries()) {
    validateMemoryRelocation(ctx, `translation.memoryRelocations[${index}]`, value, mappingIds);
  }
}

function validateMemoryRelocation(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  mappingIds: Set<string>,
): void {
  const relocation = nativeRecord(ctx, path, value);
  if (!relocation) {
    return;
  }
  validateMappingRef(ctx, `${path}.mapping`, relocation.mapping, mappingIds);
  nativeNonNegativeInt(ctx, `${path}.offset`, relocation.offset);
  nativeEnum(ctx, `${path}.kind`, relocation.kind, MEMORY_RELOCATION_KINDS);
  nativeHex(ctx, `${path}.sourceValue`, relocation.sourceValue);
  nativeOptionalHex(ctx, `${path}.targetValue`, relocation.targetValue);
  nativeEnum(ctx, `${path}.state`, relocation.state, MEMORY_RELOCATION_STATES);
  if (relocation.refusal !== undefined) {
    validateNativeRefusal(ctx, `${path}.refusal`, relocation.refusal);
  }
  if (relocation.state !== "translated" && relocation.refusal === undefined) {
    ctx.errors.push(`${path}.refusal is required when state is ${String(relocation.state)}`);
  }
}

function validateNativeBundleFiles(ctx: NativeValidationContext): void {
  if (!ctx.rootDir) {
    return;
  }
  for (const name of NATIVE_JSON_BUNDLE_FILES) {
    validateNativeExistingPath(ctx, name, "file", (stat) => stat.isFile());
  }
  validateNativeExistingPath(ctx, NATIVE_PROCESS_IMAGE_FILES.memory, "file", (stat) =>
    stat.isFile(),
  );
}

function validateNativeExistingPath(
  ctx: NativeValidationContext,
  name: string,
  kind: string,
  matches: (stat: ReturnType<typeof statSync>) => boolean,
): void {
  const file = join(ctx.rootDir!, name);
  if (!existsSync(file)) {
    ctx.errors.push(`${name} is missing`);
    return;
  }
  if (!matches(statSync(file))) {
    ctx.errors.push(`${name} must be a ${kind}`);
  }
}

function validateNativeRefusals(ctx: NativeValidationContext, path: string, value: unknown): void {
  const refusals = nativeRecord(ctx, path, value);
  if (!refusals) {
    return;
  }
  nativeEquals(ctx, `${path}.vocabularyVersion`, refusals.vocabularyVersion, 1);
  const entries = nativeArray(ctx, `${path}.refusals`, refusals.refusals);
  if (!entries) {
    return;
  }
  for (const [index, refusal] of entries.entries()) {
    validateNativeRefusal(ctx, `${path}.refusals[${index}]`, refusal);
  }
}

function validateNativeRefusal(ctx: NativeValidationContext, path: string, value: unknown): void {
  const refusal = nativeRecord(ctx, path, value);
  if (!refusal) {
    return;
  }
  nativeEnum(ctx, `${path}.code`, refusal.code, nativeProcessImageRefusalCodes);
  nativeNonEmptyString(ctx, `${path}.message`, refusal.message);
  if (refusal.detail !== undefined && !nativeRecordValue(refusal.detail)) {
    ctx.errors.push(`${path}.detail must be an object`);
  }
}

function validateUniqueId(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  seen: Set<string>,
): void {
  nativeNonEmptyString(ctx, path, value);
  if (typeof value !== "string") {
    return;
  }
  if (seen.has(value)) {
    ctx.errors.push(`${path} duplicates ${JSON.stringify(value)}`);
  }
  seen.add(value);
}

function validateMappingRef(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  mappingIds: Set<string>,
): void {
  nativeNonEmptyString(ctx, path, value);
  if (typeof value === "string" && !mappingIds.has(value)) {
    ctx.errors.push(`${path} references unknown mapping ${JSON.stringify(value)}`);
  }
}

function validateThreadRef(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  threadIds: Set<string>,
): void {
  nativeNonEmptyString(ctx, path, value);
  if (typeof value === "string" && !threadIds.has(value)) {
    ctx.errors.push(`${path} references unknown thread ${JSON.stringify(value)}`);
  }
}

function collectMappingIds(doc: unknown): Set<string> {
  const ids = new Set<string>();
  const mappings = nativeRecordValue(doc)?.mappings;
  if (!Array.isArray(mappings)) {
    return ids;
  }
  for (const mapping of mappings) {
    const id = nativeRecordValue(mapping)?.id;
    if (typeof id === "string") {
      ids.add(id);
    }
  }
  return ids;
}

function collectThreadIds(doc: unknown): Set<string> {
  const ids = new Set<string>();
  const threads = nativeRecordValue(doc)?.threads;
  if (!Array.isArray(threads)) {
    return ids;
  }
  for (const thread of threads) {
    const id = nativeRecordValue(thread)?.id;
    if (typeof id === "string") {
      ids.add(id);
    }
  }
  return ids;
}

function manifestSourceArch(doc: unknown): string | undefined {
  const capture = nativeRecordValue(nativeRecordValue(doc)?.capture);
  return typeof capture?.sourceArch === "string" ? capture.sourceArch : undefined;
}

function manifestTargetArch(doc: unknown): string | undefined {
  const target = nativeRecordValue(nativeRecordValue(doc)?.target);
  return typeof target?.arch === "string" ? target.arch : undefined;
}

function nativeVersion(ctx: NativeValidationContext, path: string, value: unknown): void {
  nativeEquals(ctx, path, value, NATIVE_PROCESS_IMAGE_FORMAT_VERSION);
}

function nativeEquals(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  expected: string | number,
): void {
  if (value !== expected) {
    ctx.errors.push(`${path} must be ${JSON.stringify(expected)}`);
  }
}

function nativeArch(ctx: NativeValidationContext, path: string, value: unknown): void {
  nativeEnum(ctx, path, value, nativeProcessImageArchitectures);
}

function nativeEnum(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  allowed: readonly string[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    ctx.errors.push(`${path} must be one of: ${allowed.join(", ")}`);
  }
}

function nativeRecord(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
): Record<string, unknown> | undefined {
  const record = nativeRecordValue(value);
  if (!record) {
    ctx.errors.push(`${path} must be an object`);
  }
  return record;
}

function nativeRecordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function nativeArray(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  opts: { minItems?: number; exactItems?: number } = {},
): unknown[] | undefined {
  if (!Array.isArray(value)) {
    ctx.errors.push(`${path} must be an array`);
    return undefined;
  }
  if (opts.minItems !== undefined && value.length < opts.minItems) {
    ctx.errors.push(`${path} must contain at least ${opts.minItems} item(s)`);
  }
  if (opts.exactItems !== undefined && value.length !== opts.exactItems) {
    ctx.errors.push(`${path} must contain exactly ${opts.exactItems} item(s)`);
  }
  return value;
}

function nativeStringArray(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
  opts: { minItems?: number } = {},
): void {
  const entries = nativeArray(ctx, path, value, opts);
  if (!entries) {
    return;
  }
  for (const [index, entry] of entries.entries()) {
    if (typeof entry !== "string") {
      ctx.errors.push(`${path}[${index}] must be a string`);
    }
  }
}

function nativeStringRecord(ctx: NativeValidationContext, path: string, value: unknown): void {
  const record = nativeRecord(ctx, path, value);
  if (!record) {
    return;
  }
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string") {
      ctx.errors.push(`${path}.${key} must be a string`);
    }
  }
}

function nativeNonEmptyString(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || value.length === 0) {
    ctx.errors.push(`${path} must be a non-empty string`);
  }
}

function nativeOptionalString(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (value !== undefined && typeof value !== "string") {
    ctx.errors.push(`${path} must be a string`);
  }
}

function nativeAbsolutePath(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || !value.startsWith("/")) {
    ctx.errors.push(`${path} must be an absolute path`);
  }
}

function nativeHex(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (typeof value !== "string" || !HEX_ADDRESS_RE.test(value)) {
    ctx.errors.push(`${path} must be a hex address`);
  }
}

function nativeOptionalHex(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (value !== undefined) {
    nativeHex(ctx, path, value);
  }
}

function nativeBoolean(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (typeof value !== "boolean") {
    ctx.errors.push(`${path} must be a boolean`);
  }
}

function nativeNonNegativeInt(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (!Number.isInteger(value) || Number(value) < 0) {
    ctx.errors.push(`${path} must be a non-negative integer`);
  }
}

function nativeOptionalNonNegativeInt(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
): void {
  if (value !== undefined) {
    nativeNonNegativeInt(ctx, path, value);
  }
}

function nativeOptionalPositiveInt(
  ctx: NativeValidationContext,
  path: string,
  value: unknown,
): void {
  if (value !== undefined && (!Number.isInteger(value) || Number(value) < 1)) {
    ctx.errors.push(`${path} must be a positive integer`);
  }
}

function nativeOptionalBuildId(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (value !== undefined && (typeof value !== "string" || !BUILD_ID_RE.test(value))) {
    ctx.errors.push(`${path} must be 8-128 hex characters`);
  }
}

function nativeOptionalSha256(ctx: NativeValidationContext, path: string, value: unknown): void {
  if (value !== undefined && (typeof value !== "string" || !SHA256_RE.test(value))) {
    ctx.errors.push(`${path} must be 64 hex characters`);
  }
}

function isKernelMappingKind(value: unknown): boolean {
  return value === "vdso" || value === "vvar" || value === "special";
}

const NATIVE_JSON_BUNDLE_FILES = [
  NATIVE_PROCESS_IMAGE_FILES.manifest,
  NATIVE_PROCESS_IMAGE_FILES.mappings,
  NATIVE_PROCESS_IMAGE_FILES.threads,
  NATIVE_PROCESS_IMAGE_FILES.resources,
  NATIVE_PROCESS_IMAGE_FILES.translation,
] as const;

const MEMORY_MAPPING_KINDS = [
  "text",
  "data",
  "heap",
  "stack",
  "tls",
  "vdso",
  "vvar",
  "file",
  "anonymous",
  "shared",
  "special",
] as const;
const TARGET_MATERIALIZATIONS = ["translate", "recreate", "omit", "refuse"] as const;
const THREAD_STOP_REASONS = ["ptrace-stop", "signal-delivery-stop", "group-stop"] as const;
const SYSCALL_STATES = ["outside-syscall", "inside-syscall", "restart-block"] as const;
const ALT_STACK_STATES = ["disabled", "enabled", "unsupported"] as const;
const RSEQ_STATES = ["absent", "captured", "unsupported"] as const;
const TLS_THREAD_POINTER_REGISTERS = ["arm64-tpidr-el0", "amd64-fs-base"] as const;
const TLS_TARGET_SEGMENT_BASE_STATES = ["not-required", "provided", "unsupported"] as const;
const SIMD_FPU_STATES = ["not-live", "requires-restore", "not-captured", "unsupported"] as const;
const SIMD_FPU_LIVE_SUBSETS = [
  "fp-control-state",
  "caller-saved-vector-registers",
  "callee-saved-vector-registers",
  "unknown-live-state",
] as const;
const RESOURCE_KINDS = [
  "argv",
  "env",
  "cwd",
  "exe",
  "auxv",
  "fd",
  "file",
  "pipe",
  "socket",
  "raw-socket",
  "pty",
  "timer",
  "eventfd",
  "signal",
  "namespace",
  "credential",
  "futex",
  "epoll",
  "unknown",
] as const;
const RESOURCE_STATES = ["captured", "recipe", "refused", "unsupported"] as const;
const TRANSLATION_STATES = ["mapped", "pending", "refused"] as const;
const THREAD_TRANSLATION_STATES = ["pending", "translated", "refused"] as const;
const MEMORY_RELOCATION_KINDS = [
  "pointer",
  "code-pointer",
  "return-address",
  "thread-pointer",
] as const;
const MEMORY_RELOCATION_STATES = ["translated", "ambiguous", "refused"] as const;
const AMD64_REGISTER_FIELDS = [
  "rip",
  "rsp",
  "rflags",
  "rax",
  "rbx",
  "rcx",
  "rdx",
  "rsi",
  "rdi",
  "rbp",
  "r8",
  "r9",
  "r10",
  "r11",
  "r12",
  "r13",
  "r14",
  "r15",
  "fsBase",
  "gsBase",
] as const;
const HEX_ADDRESS_RE = /^0x[0-9A-Fa-f]+$/;
const BUILD_ID_RE = /^[0-9A-Fa-f]{8,128}$/;
const SHA256_RE = /^[0-9A-Fa-f]{64}$/;
