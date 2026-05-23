import type {
  NativeModeledFdReadTargetResource,
  NativeModeledPpollTargetResource,
} from "./native-active-syscall-policy.ts";
import type { NativeReturnChainFrameWrite } from "./native-return-chain-materializer.ts";
import type {
  NativeStackWindowGuardMapping,
  NativeStackWindowWrite,
} from "./native-stack-window-materializer.ts";
import type { TargetGuestActiveSyscallRestoreStep } from "./target-guest-active-syscall-restore.ts";
import type { TargetGuestExecutableMappingStep } from "./target-guest-executable-materialization.ts";
import type { TargetGuestMemoryMaterializationEntry } from "./target-guest-memory-materialization.ts";
import type { TargetGuestPrivateMemoryRestoreStep } from "./target-guest-private-memory-restore.ts";
import type { TargetGuestSignalRestoreStep } from "./target-guest-signal-restore.ts";
import type { TargetGuestTwoThreadSpawnStep } from "./target-guest-two-thread-restore.ts";

export const TARGET_GUEST_RESTORE_DESCRIPTOR_KIND = "machinen.target-guest-restore";

export type TargetGuestRestoreLoaderRefusalCode =
  | "target-guest-loader-descriptor-invalid"
  | "target-guest-loader-target-arch-unsupported"
  | "target-guest-loader-resource-unsupported"
  | "target-guest-loader-invalid-fd"
  | "target-guest-loader-invalid-continuation"
  | "target-guest-loader-memory-unsupported"
  | "target-guest-loader-frame-unsupported";

export class TargetGuestRestoreLoaderValidationError extends Error {
  constructor(
    public readonly code: TargetGuestRestoreLoaderRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = "TargetGuestRestoreLoaderValidationError";
  }
}

export type TargetGuestRestoreResourceRecipe =
  | { kind: "close-fd"; fd: number; reason?: string }
  | { kind: "inherit-stdio"; fd: 1 | 2; stream: "stdout" | "stderr"; closeOnExec?: boolean }
  | {
      kind: "reopen-file";
      fd: number;
      path: string;
      offset: number;
      access: 0 | 1 | 2;
      closeOnExec?: boolean;
    }
  | { kind: "synthetic-empty-pipe"; readFd: number; writeFd?: number; closeOnExec?: boolean }
  | { kind: "synthetic-empty-eventfd"; fd: number; closeOnExec?: boolean }
  | { kind: "synthetic-timerfd"; fd: number; closeOnExec?: boolean };

export type TargetGuestRestoreResumeMode = "translated-frame";

export type TargetGuestResumeRegisterName =
  | "rax"
  | "rdi"
  | "rsi"
  | "rdx"
  | "rcx"
  | "r8"
  | "r9"
  | "r10"
  | "r11";

export type TargetGuestResumeRegisters = Record<TargetGuestResumeRegisterName, string>;

export interface TargetGuestRestoreContinuationDescriptor {
  codeFile: string;
  fileOffset: number;
  codeSize: number;
  targetAddress: string;
  argument0?: string;
  stateReportAddress?: string;
  targetFsBase?: string;
  translatedReturnAddress?: string;
  resumeMode?: TargetGuestRestoreResumeMode;
  resumeRflags?: string;
  resumeRegisters?: TargetGuestResumeRegisters;
  timeoutSeconds: number;
  stackTargetStart: string;
  stackSize: number;
  stackPointer: string;
}

export interface TargetGuestTranslatedFrameDescriptor {
  kind: "single-target-caller-frame";
  framePointer: string;
  canonicalFrameAddress: string;
  returnAddressSlot: string;
  returnAddress: string;
  unwindId: string;
  calleeSaved: TargetGuestTranslatedFrameRegister[];
  slots: TargetGuestTranslatedFrameSlot[];
}

export type TargetGuestTranslatedFrameRegisterName = "rbx" | "r12" | "r13" | "r14" | "r15";

export interface TargetGuestTranslatedFrameRegister {
  register: TargetGuestTranslatedFrameRegisterName;
  value: string;
}

export interface TargetGuestTranslatedFrameSlot {
  offset: number;
  value: string;
  classification: "non-pointer-data";
}

export type TargetGuestNativeRestoreStep =
  | { section: "stack-window-write"; write: NativeStackWindowWrite }
  | { section: "stack-window-guard"; guard: NativeStackWindowGuardMapping }
  | { section: "return-chain-write"; write: NativeReturnChainFrameWrite }
  | { section: "private-memory"; step: TargetGuestPrivateMemoryRestoreStep }
  | { section: "executable-mapping"; step: TargetGuestExecutableMappingStep }
  | { section: "signal-restore"; step: TargetGuestSignalRestoreStep }
  | { section: "active-syscall"; step: TargetGuestActiveSyscallRestoreStep }
  | { section: "thread-spawn"; step: TargetGuestTwoThreadSpawnStep };

export interface TargetGuestRestoreDescriptor {
  kind: typeof TARGET_GUEST_RESTORE_DESCRIPTOR_KIND;
  targetArch: "amd64";
  continuation: TargetGuestRestoreContinuationDescriptor;
  translatedFrame?: TargetGuestTranslatedFrameDescriptor;
  resources: TargetGuestRestoreResourceRecipe[];
  memory: TargetGuestMemoryMaterializationEntry[];
  nativeRestore?: TargetGuestNativeRestoreStep[];
}

export function serializeTargetGuestRestoreDescriptor(
  descriptor: TargetGuestRestoreDescriptor,
): string {
  const validated = validateTargetGuestRestoreDescriptor(descriptor);
  const continuation = validated.continuation;
  return [
    `kind=${validated.kind}`,
    `targetArch=${validated.targetArch}`,
    `codeFile=${continuation.codeFile}`,
    `fileOffset=${continuation.fileOffset}`,
    `codeSize=${continuation.codeSize}`,
    `targetAddress=${continuation.targetAddress}`,
    ...optionalContinuationField("argument0", continuation.argument0),
    ...optionalContinuationField("stateReportAddress", continuation.stateReportAddress),
    ...optionalContinuationField("targetFsBase", continuation.targetFsBase),
    ...optionalContinuationField("translatedReturnAddress", continuation.translatedReturnAddress),
    ...optionalContinuationField("resumeMode", continuation.resumeMode),
    ...optionalContinuationField("resumeRflags", continuation.resumeRflags),
    ...resumeRegisterFields(continuation.resumeRegisters),
    `timeoutSeconds=${continuation.timeoutSeconds}`,
    `stackTargetStart=${continuation.stackTargetStart}`,
    `stackSize=${continuation.stackSize}`,
    `stackPointer=${continuation.stackPointer}`,
    ...optionalTranslatedFrameField(validated.translatedFrame),
    ...validated.resources.map(serializeResourceRecipe),
    ...validated.memory.map(serializeMemoryEntry),
    ...(validated.nativeRestore ?? []).map(serializeNativeRestoreStep),
    "",
  ].join("\n");
}

export function parseTargetGuestRestoreDescriptor(text: string): TargetGuestRestoreDescriptor {
  const fields = new Map<string, string>();
  const resources: TargetGuestRestoreResourceRecipe[] = [];
  const memory: TargetGuestMemoryMaterializationEntry[] = [];
  const nativeRestore: TargetGuestNativeRestoreStep[] = [];
  let translatedFrame: TargetGuestTranslatedFrameDescriptor | undefined;
  for (const line of descriptorLines(text)) {
    if (line.startsWith("resource=")) {
      resources.push(parseResourceRecipe(line));
    } else if (line.startsWith("memory=")) {
      memory.push(parseMemoryEntry(line));
    } else if (line.startsWith("frame=")) {
      translatedFrame = parseTranslatedFrame(line);
    } else if (line.startsWith("native=")) {
      nativeRestore.push(parseNativeRestoreStep(line));
    } else {
      const [key, value] = splitField(line);
      fields.set(key, value);
    }
  }
  return validateTargetGuestRestoreDescriptor(
    fieldsToDescriptor(fields, resources, memory, translatedFrame, nativeRestore),
  );
}

export function validateTargetGuestRestoreDescriptor(
  descriptor: TargetGuestRestoreDescriptor,
): TargetGuestRestoreDescriptor {
  assertDescriptorHeader(descriptor);
  const continuation = validateContinuation(descriptor.continuation);
  const resources = descriptor.resources.map(validateResourceRecipe);
  assertUniqueResourceFds(resources);
  const memory = descriptor.memory.map(validateMemoryEntry);
  const nativeRestore = descriptor.nativeRestore?.map(validateNativeRestoreStep);
  const translatedFrame = validateTranslatedFrame(descriptor.translatedFrame, continuation);
  const validated =
    translatedFrame === undefined
      ? { ...descriptor, continuation, resources, memory }
      : { ...descriptor, continuation, translatedFrame, resources, memory };
  return nativeRestore === undefined ? validated : { ...validated, nativeRestore };
}

export function buildNativeActualResumeTrampolineArgs(
  descriptor: TargetGuestRestoreDescriptor,
): string[] {
  const validated = validateTargetGuestRestoreDescriptor(descriptor);
  const continuation = validated.continuation;
  return [
    "--code-file",
    continuation.codeFile,
    "--file-offset",
    String(continuation.fileOffset),
    "--code-size",
    String(continuation.codeSize),
    "--target-address",
    continuation.targetAddress,
    ...optionalArg("--argument0", continuation.argument0),
    ...optionalArg("--state-report-address", continuation.stateReportAddress),
    ...optionalArg("--target-fs-base", continuation.targetFsBase),
    ...optionalArg("--translated-return-address", continuation.translatedReturnAddress),
    ...optionalArg("--resume-mode", continuation.resumeMode),
    ...optionalArg("--resume-rflags", continuation.resumeRflags),
    ...resumeRegisterArgs(continuation.resumeRegisters),
    "--timeout-seconds",
    String(continuation.timeoutSeconds),
    "--stack-target-start",
    continuation.stackTargetStart,
    "--stack-size",
    String(continuation.stackSize),
    "--stack-pointer",
    continuation.stackPointer,
    ...translatedFrameToTrampolineArgs(validated.translatedFrame),
    ...validated.resources.flatMap(resourceToTrampolineArgs),
    ...validated.memory.flatMap(memoryToTrampolineArgs),
    ...(validated.nativeRestore ?? []).flatMap(nativeRestoreToTrampolineArgs),
  ];
}

export function buildTargetGuestRestoreLoaderArgv(
  descriptorPath: string,
  trampolinePath: string,
): string[] {
  return ["--descriptor", descriptorPath, "--trampoline", trampolinePath];
}

function descriptorLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function splitField(line: string): [string, string] {
  const index = line.indexOf("=");
  if (index <= 0) {
    fail("target-guest-loader-descriptor-invalid", "descriptor line must be key=value");
  }
  return [line.slice(0, index), line.slice(index + 1)];
}

function fieldsToDescriptor(
  fields: Map<string, string>,
  resources: TargetGuestRestoreResourceRecipe[],
  memory: TargetGuestMemoryMaterializationEntry[],
  translatedFrame: TargetGuestTranslatedFrameDescriptor | undefined,
  nativeRestore: TargetGuestNativeRestoreStep[] = [],
): TargetGuestRestoreDescriptor {
  return {
    kind: requiredField(fields, "kind") as typeof TARGET_GUEST_RESTORE_DESCRIPTOR_KIND,
    targetArch: requiredField(fields, "targetArch") as "amd64",
    continuation: {
      codeFile: requiredField(fields, "codeFile"),
      fileOffset: parseIntegerField(fields, "fileOffset"),
      codeSize: parseIntegerField(fields, "codeSize"),
      targetAddress: requiredField(fields, "targetAddress"),
      argument0: optionalField(fields, "argument0"),
      stateReportAddress: optionalField(fields, "stateReportAddress"),
      targetFsBase: optionalField(fields, "targetFsBase"),
      translatedReturnAddress: optionalField(fields, "translatedReturnAddress"),
      resumeMode: optionalField(fields, "resumeMode") as TargetGuestRestoreResumeMode | undefined,
      resumeRflags: optionalField(fields, "resumeRflags"),
      resumeRegisters: parseResumeRegisters(fields),
      timeoutSeconds: parseIntegerField(fields, "timeoutSeconds"),
      stackTargetStart: requiredField(fields, "stackTargetStart"),
      stackSize: parseIntegerField(fields, "stackSize"),
      stackPointer: requiredField(fields, "stackPointer"),
    },
    translatedFrame,
    resources,
    memory,
    nativeRestore: nativeRestore.length === 0 ? undefined : nativeRestore,
  };
}

function parseTranslatedFrame(line: string): TargetGuestTranslatedFrameDescriptor {
  const [head, ...fields] = line.split(/\s+/);
  const kind = head!.slice("frame=".length);
  const values = translatedFrameFieldMap(fields);
  if (kind !== "single-target-caller-frame") {
    fail("target-guest-loader-frame-unsupported", `unsupported translated frame: ${kind}`);
  }
  return {
    kind,
    framePointer: requiredFrameField(values, "framePointer"),
    canonicalFrameAddress: requiredFrameField(values, "canonicalFrameAddress"),
    returnAddressSlot: requiredFrameField(values, "returnAddressSlot"),
    returnAddress: requiredFrameField(values, "returnAddress"),
    unwindId: requiredFrameField(values, "unwindId"),
    calleeSaved: parseFrameRegisters(values),
    slots: parseFrameSlots(values),
  };
}

const TARGET_FRAME_CALLEE_SAVED_REGISTERS = ["rbx", "r12", "r13", "r14", "r15"] as const;
const TARGET_FRAME_MAX_SLOTS = 8;

const TARGET_FRAME_REGISTER_FIELDS: Record<TargetGuestTranslatedFrameRegisterName, string> = {
  rbx: "calleeSavedRbx",
  r12: "calleeSavedR12",
  r13: "calleeSavedR13",
  r14: "calleeSavedR14",
  r15: "calleeSavedR15",
};

function translatedFrameFieldMap(fields: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const field of fields) {
    const [key, value] = splitField(field);
    if (values.has(key)) {
      fail("target-guest-loader-frame-unsupported", "duplicate translated frame field");
    }
    values.set(key, value);
  }
  return values;
}

function parseFrameRegisters(fields: Map<string, string>): TargetGuestTranslatedFrameRegister[] {
  return TARGET_FRAME_CALLEE_SAVED_REGISTERS.flatMap((register) => {
    const value = fields.get(TARGET_FRAME_REGISTER_FIELDS[register]);
    return value === undefined ? [] : [{ register, value }];
  });
}

function parseFrameSlots(fields: Map<string, string>): TargetGuestTranslatedFrameSlot[] {
  const indexes = frameSlotIndexes(fields);
  if (indexes.length === 0) {
    return [];
  }
  assertDenseFrameSlotIndexes(indexes);
  return indexes.map((index) => parseFrameSlot(fields, index));
}

function frameSlotIndexes(fields: Map<string, string>): number[] {
  const indexes = new Set<number>();
  for (const key of fields.keys()) {
    const match = /^slot(\d+)(?:Offset|Value|Class)$/.exec(key);
    if (!match) {
      continue;
    }
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= TARGET_FRAME_MAX_SLOTS) {
      fail("target-guest-loader-frame-unsupported", "too many translated frame slots");
    }
    indexes.add(index);
  }
  return [...indexes].sort((left, right) => left - right);
}

function assertDenseFrameSlotIndexes(indexes: number[]): void {
  indexes.forEach((index, expected) => {
    if (index !== expected) {
      fail("target-guest-loader-frame-unsupported", "translated frame slots must be dense");
    }
  });
}

function parseFrameSlot(
  fields: Map<string, string>,
  index: number,
): TargetGuestTranslatedFrameSlot {
  const classification = requiredFrameField(fields, `slot${index}Class`);
  if (classification !== "non-pointer-data") {
    fail("target-guest-loader-frame-unsupported", "frame slot classification is unsupported");
  }
  return {
    offset: parseFrameInteger(fields, `slot${index}Offset`),
    value: requiredFrameField(fields, `slot${index}Value`),
    classification,
  };
}

function requiredFrameField(fields: Map<string, string>, key: string): string {
  return fields.get(key) ?? fail("target-guest-loader-descriptor-invalid", `${key} is required`);
}

function parseFrameInteger(fields: Map<string, string>, key: string): number {
  const parsed = Number(requiredFrameField(fields, key));
  if (!Number.isSafeInteger(parsed)) {
    fail("target-guest-loader-descriptor-invalid", `${key} must be an integer`);
  }
  return parsed;
}

function requiredField(fields: Map<string, string>, key: string): string {
  return fields.get(key) ?? fail("target-guest-loader-descriptor-invalid", `${key} is required`);
}

function optionalField(fields: Map<string, string>, key: string): string | undefined {
  return fields.get(key);
}

function parseIntegerField(fields: Map<string, string>, key: string): number {
  const parsed = Number(requiredField(fields, key));
  if (!Number.isSafeInteger(parsed)) {
    fail("target-guest-loader-descriptor-invalid", `${key} must be an integer`);
  }
  return parsed;
}

function parseResourceRecipe(line: string): TargetGuestRestoreResourceRecipe {
  const [head, ...fields] = line.split(/\s+/);
  const kind = head!.slice("resource=".length);
  const values = new Map(fields.map(splitField));
  return resourceFromFields(kind, values);
}

const RESOURCE_RECIPE_PARSERS: Record<
  string,
  (fields: Map<string, string>) => TargetGuestRestoreResourceRecipe
> = {
  "close-fd": (fields) => ({
    kind: "close-fd",
    fd: parseResourceInteger(fields, "fd"),
    reason: fields.get("reason"),
  }),
  "inherit-stdio": parseInheritedStdioRecipe,
  "reopen-file": parseReopenFileRecipe,
  "synthetic-empty-pipe": (fields) => ({
    kind: "synthetic-empty-pipe",
    readFd: parseResourceInteger(fields, "readFd"),
    writeFd: optionalResourceInteger(fields, "writeFd"),
    closeOnExec: parseResourceBoolean(fields, "closeOnExec"),
  }),
  "synthetic-empty-eventfd": (fields) =>
    parseSingleFdSyntheticRecipe("synthetic-empty-eventfd", fields),
  "synthetic-timerfd": (fields) => parseSingleFdSyntheticRecipe("synthetic-timerfd", fields),
};

function resourceFromFields(
  kind: string,
  fields: Map<string, string>,
): TargetGuestRestoreResourceRecipe {
  const parser = RESOURCE_RECIPE_PARSERS[kind];
  return parser
    ? parser(fields)
    : fail("target-guest-loader-resource-unsupported", `unsupported resource recipe: ${kind}`);
}

function parseInheritedStdioRecipe(fields: Map<string, string>): TargetGuestRestoreResourceRecipe {
  const fd = parseStdioFd(fields);
  const stream = parseStdioStream(fields);
  if ((fd === 1 && stream !== "stdout") || (fd === 2 && stream !== "stderr")) {
    fail("target-guest-loader-invalid-fd", "stdio fd and stream do not match");
  }
  return {
    kind: "inherit-stdio",
    fd,
    stream,
    closeOnExec: parseResourceBoolean(fields, "closeOnExec"),
  };
}

function parseReopenFileRecipe(fields: Map<string, string>): TargetGuestRestoreResourceRecipe {
  return {
    kind: "reopen-file",
    fd: parseResourceInteger(fields, "fd"),
    path: requiredResourceField(fields, "path"),
    offset: parseResourceInteger(fields, "offset"),
    access: parseResourceAccess(fields),
    closeOnExec: parseResourceBoolean(fields, "closeOnExec"),
  };
}

function parseSingleFdSyntheticRecipe(
  kind: "synthetic-empty-eventfd" | "synthetic-timerfd",
  fields: Map<string, string>,
): TargetGuestRestoreResourceRecipe {
  return {
    kind,
    fd: parseResourceInteger(fields, "fd"),
    closeOnExec: parseResourceBoolean(fields, "closeOnExec"),
  };
}

function parseResourceInteger(fields: Map<string, string>, key: string): number {
  const parsed = Number(requiredResourceField(fields, key));
  if (!Number.isSafeInteger(parsed)) {
    fail("target-guest-loader-invalid-fd", `${key} must be an integer fd`);
  }
  return parsed;
}

function optionalResourceInteger(fields: Map<string, string>, key: string): number | undefined {
  const value = fields.get(key);
  return value === undefined ? undefined : parseResourceInteger(fields, key);
}

function parseStdioFd(fields: Map<string, string>): 1 | 2 {
  const fd = parseResourceInteger(fields, "fd");
  if (fd !== 1 && fd !== 2) {
    fail("target-guest-loader-invalid-fd", "inherited stdio only supports fd 1 or 2");
  }
  return fd;
}

function parseStdioStream(fields: Map<string, string>): "stdout" | "stderr" {
  const stream = requiredResourceField(fields, "stream");
  if (stream !== "stdout" && stream !== "stderr") {
    fail("target-guest-loader-invalid-fd", "stdio stream must be stdout or stderr");
  }
  return stream;
}

function parseResourceAccess(fields: Map<string, string>): 0 | 1 | 2 {
  const access = parseResourceInteger(fields, "access");
  if (access !== 0 && access !== 1 && access !== 2) {
    fail("target-guest-loader-descriptor-invalid", "file access must be 0, 1, or 2");
  }
  return access;
}

function parseResourceBoolean(fields: Map<string, string>, key: string): boolean | undefined {
  const value = fields.get(key);
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  fail("target-guest-loader-descriptor-invalid", `${key} must be true or false`);
}

function requiredResourceField(fields: Map<string, string>, key: string): string {
  return fields.get(key) ?? fail("target-guest-loader-descriptor-invalid", `${key} is required`);
}

function parseMemoryEntry(line: string): TargetGuestMemoryMaterializationEntry {
  const [head, ...fields] = line.split(/\s+/);
  const kind = head!.slice("memory=".length);
  const values = new Map(fields.map(splitField));
  return memoryFromFields(kind, values);
}

function memoryFromFields(
  kind: string,
  fields: Map<string, string>,
): TargetGuestMemoryMaterializationEntry {
  if (kind === "copy-captured-bytes") {
    return {
      kind,
      mapping: requiredMemoryField(fields, "mapping"),
      targetStart: requiredMemoryField(fields, "targetStart"),
      sizeBytes: parseMemoryInteger(fields, "sizeBytes"),
      permissions: requiredMemoryField(fields, "permissions"),
      sourceFile: requiredMemoryField(fields, "sourceFile"),
      sourceOffset: parseMemoryInteger(fields, "sourceOffset"),
      provenance: "native-process-image",
    };
  }
  if (kind === "recreate-guard") {
    return {
      kind,
      mapping: requiredMemoryField(fields, "mapping"),
      targetStart: requiredMemoryField(fields, "targetStart"),
      sizeBytes: parseMemoryInteger(fields, "sizeBytes"),
      permissions: requiredMemoryField(fields, "permissions"),
      provenance: "guard-protection",
    };
  }
  return fail("target-guest-loader-memory-unsupported", `unsupported memory entry: ${kind}`);
}

function parseMemoryInteger(fields: Map<string, string>, key: string): number {
  const parsed = Number(requiredMemoryField(fields, key));
  if (!Number.isSafeInteger(parsed)) {
    fail("target-guest-loader-invalid-continuation", `${key} must be an integer`);
  }
  return parsed;
}

function requiredMemoryField(fields: Map<string, string>, key: string): string {
  return fields.get(key) ?? fail("target-guest-loader-descriptor-invalid", `${key} is required`);
}

function parseNativeRestoreStep(line: string): TargetGuestNativeRestoreStep {
  const [head, ...fields] = line.split(/\s+/);
  const section = head!.slice("native=".length);
  const values = new Map(fields.map(splitField));
  switch (section) {
    case "stack-window-write":
      return { section, write: parseNativeStackWindowWrite(values) };
    case "stack-window-guard":
      return { section, guard: parseNativeStackWindowGuard(values) };
    case "return-chain-write":
      return { section, write: parseNativeReturnChainWrite(values) };
    case "private-memory":
      return { section, step: parseNativePrivateMemoryStep(values) };
    case "executable-mapping":
      return { section, step: parseNativeExecutableMappingStep(values) };
    case "signal-restore":
      return { section, step: parseNativeSignalRestoreStep(values) };
    case "active-syscall":
      return { section, step: parseNativeActiveSyscallStep(values) };
    case "thread-spawn":
      return { section, step: parseNativeThreadSpawnStep(values) };
    default:
      return fail(
        "target-guest-loader-descriptor-invalid",
        `unsupported native restore section: ${section}`,
      );
  }
}

function parseNativeStackWindowWrite(fields: Map<string, string>): NativeStackWindowWrite {
  return {
    mapping: requiredNativeField(fields, "mapping"),
    targetAddress: requiredNativeField(fields, "targetAddress"),
    offset: parseNativeInteger(fields, "offset"),
    sizeBytes: parseNativeInteger(fields, "sizeBytes") as 8,
    value: requiredNativeField(fields, "value"),
    bytes: requiredNativeField(fields, "bytes"),
    kind: requiredNativeField(fields, "kind") as NativeStackWindowWrite["kind"],
  };
}

function parseNativeStackWindowGuard(fields: Map<string, string>): NativeStackWindowGuardMapping {
  return {
    targetStart: requiredNativeField(fields, "targetStart"),
    sizeBytes: parseNativeInteger(fields, "sizeBytes"),
    placement: requiredNativeField(
      fields,
      "placement",
    ) as NativeStackWindowGuardMapping["placement"],
  };
}

function parseNativeReturnChainWrite(fields: Map<string, string>): NativeReturnChainFrameWrite {
  return {
    frameId: requiredNativeField(fields, "frameId"),
    targetAddress: requiredNativeField(fields, "targetAddress"),
    value: requiredNativeField(fields, "value"),
    bytes: requiredNativeField(fields, "bytes"),
    kind: requiredNativeField(fields, "kind") as NativeReturnChainFrameWrite["kind"],
  };
}

function parseNativePrivateMemoryStep(
  fields: Map<string, string>,
): TargetGuestPrivateMemoryRestoreStep {
  const action = requiredNativeField(fields, "action");
  if (action === "copy-captured-bytes") {
    return {
      action,
      mapping: requiredNativeField(fields, "mapping"),
      sourceFile: requiredNativeField(fields, "sourceFile"),
      sourceOffset: parseNativeInteger(fields, "sourceOffset"),
      targetStart: requiredNativeField(fields, "targetStart"),
      sizeBytes: parseNativeInteger(fields, "sizeBytes"),
    };
  }
  if (action === "mmap-private-writable" || action === "mprotect-final") {
    return {
      action,
      mapping: requiredNativeField(fields, "mapping"),
      targetStart: requiredNativeField(fields, "targetStart"),
      sizeBytes: parseNativeInteger(fields, "sizeBytes"),
      permissions: requiredNativeField(fields, "permissions"),
    };
  }
  if (action === "mmap-guard") {
    return {
      action,
      mapping: requiredNativeField(fields, "mapping"),
      targetStart: requiredNativeField(fields, "targetStart"),
      sizeBytes: parseNativeInteger(fields, "sizeBytes"),
      permissions: "---p",
    };
  }
  return fail("target-guest-loader-descriptor-invalid", "unsupported native private-memory action");
}

function parseNativeExecutableMappingStep(
  fields: Map<string, string>,
): TargetGuestExecutableMappingStep {
  const action = requiredNativeField(fields, "action");
  if (action !== "map-target-executable") {
    fail("target-guest-loader-descriptor-invalid", "unsupported native executable action");
  }
  return {
    action,
    mapping: requiredNativeField(fields, "mapping"),
    targetStart: requiredNativeField(fields, "targetStart"),
    sizeBytes: parseNativeInteger(fields, "sizeBytes"),
    permissions: {
      read: parseNativeBoolean(fields, "read"),
      write: parseNativeBoolean(fields, "write"),
      execute: parseNativeBoolean(fields, "execute"),
      private: parseNativeBoolean(fields, "private"),
      shared: parseNativeBoolean(fields, "shared"),
    },
    path: requiredNativeField(fields, "path"),
    fileOffset: parseNativeInteger(fields, "fileOffset"),
    buildId: fields.get("buildId"),
    sha256: fields.get("sha256"),
    sourceTextReusedAsTargetCode: false,
  };
}

function parseNativeSignalRestoreStep(fields: Map<string, string>): TargetGuestSignalRestoreStep {
  const action = requiredNativeField(fields, "action");
  const threadId = requiredNativeField(fields, "threadId");
  if (action === "save-loader-signal-mask" || action === "restore-loader-signal-mask") {
    return { action, threadId };
  }
  if (action === "sigprocmask-set-blocked" || action === "verify-blocked-signal-mask") {
    return { action, threadId, targetBlockedMasks: parseNativeList(fields, "targetBlockedMasks") };
  }
  return fail("target-guest-loader-descriptor-invalid", "unsupported native signal restore action");
}

function parseNativeThreadSpawnStep(fields: Map<string, string>): TargetGuestTwoThreadSpawnStep {
  return {
    action: "spawn-target-thread",
    threadId: requiredNativeField(fields, "threadId"),
    stackBase: requiredNativeField(fields, "stackBase"),
    stackLimit: requiredNativeField(fields, "stackLimit"),
    registers: {
      rip: requiredNativeField(fields, "rip"),
      rsp: requiredNativeField(fields, "rsp"),
    },
  };
}

function parseNativeActiveSyscallStep(
  fields: Map<string, string>,
): TargetGuestActiveSyscallRestoreStep {
  const action = requiredNativeField(fields, "action");
  if (action === "rearm-sleep-timer") {
    return {
      action,
      threadId: requiredNativeField(fields, "threadId"),
      syscallName: requiredNativeField(fields, "syscallName"),
      remainingTime: parseNativeDuration(fields),
      resumeMode: "defer-target-resume",
    };
  }
  if (action === "rearm-ppoll-timeout") {
    return {
      action,
      threadId: requiredNativeField(fields, "threadId"),
      remainingTime: parseNativeDuration(fields),
      nfds: parseNativeInteger(fields, "nfds") as 0 | 1,
      resources: parseNativeList(fields, "resources") as NativeModeledPpollTargetResource[],
      resumeMode: "defer-target-resume",
    };
  }
  if (action === "restore-fd-read-block") {
    return {
      action,
      threadId: requiredNativeField(fields, "threadId"),
      fd: parseNativeInteger(fields, "fd"),
      countBytes: parseNativeInteger(fields, "countBytes"),
      resource: requiredNativeField(fields, "resource") as NativeModeledFdReadTargetResource,
      resumeMode: "defer-target-resume",
    };
  }
  return fail("target-guest-loader-descriptor-invalid", "unsupported native active-syscall action");
}

function parseNativeDuration(fields: Map<string, string>): {
  seconds: string;
  nanoseconds: number;
} {
  return {
    seconds: requiredNativeField(fields, "seconds"),
    nanoseconds: parseNativeInteger(fields, "nanoseconds"),
  };
}

function requiredNativeField(fields: Map<string, string>, key: string): string {
  return fields.get(key) ?? fail("target-guest-loader-descriptor-invalid", `${key} is required`);
}

function parseNativeInteger(fields: Map<string, string>, key: string): number {
  const parsed = Number(requiredNativeField(fields, key));
  if (!Number.isSafeInteger(parsed)) {
    fail("target-guest-loader-invalid-continuation", `${key} must be an integer`);
  }
  return parsed;
}

function parseNativeBoolean(fields: Map<string, string>, key: string): boolean {
  const value = requiredNativeField(fields, key);
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fail("target-guest-loader-descriptor-invalid", `${key} must be true or false`);
}

function parseNativeList(fields: Map<string, string>, key: string): string[] {
  const value = requiredNativeField(fields, key);
  return value.length === 0 ? [] : value.split(",");
}

function assertDescriptorHeader(descriptor: TargetGuestRestoreDescriptor): void {
  if (descriptor.kind !== TARGET_GUEST_RESTORE_DESCRIPTOR_KIND) {
    fail("target-guest-loader-descriptor-invalid", "descriptor kind is not supported");
  }
  if (descriptor.targetArch !== "amd64") {
    fail("target-guest-loader-target-arch-unsupported", "target guest loader requires amd64");
  }
}

function validateContinuation(
  continuation: TargetGuestRestoreContinuationDescriptor,
): TargetGuestRestoreContinuationDescriptor {
  assertPositive(continuation.codeSize, "codeSize");
  assertNonNegative(continuation.fileOffset, "fileOffset");
  assertPositive(continuation.timeoutSeconds, "timeoutSeconds");
  assertPositive(continuation.stackSize, "stackSize");
  assertHexAddress(continuation.targetAddress, "targetAddress");
  validateOptionalContinuationAddress(continuation.argument0, "argument0");
  validateArgumentRegisterConflict(continuation);
  validateOptionalContinuationAddress(continuation.stateReportAddress, "stateReportAddress");
  validateTargetFsBase(continuation);
  validateOptionalContinuationAddress(
    continuation.translatedReturnAddress,
    "translatedReturnAddress",
  );
  if (continuation.resumeMode !== undefined && continuation.resumeMode !== "translated-frame") {
    fail("target-guest-loader-invalid-continuation", "resumeMode is unsupported");
  }
  validateResumeRflags(continuation.resumeRflags);
  validateResumeRegisters(continuation.resumeRegisters);
  assertHexAddress(continuation.stackTargetStart, "stackTargetStart");
  assertHexAddress(continuation.stackPointer, "stackPointer");
  return continuation;
}

function validateOptionalContinuationAddress(value: string | undefined, field: string): void {
  if (value !== undefined) {
    assertHexAddress(value, field);
  }
}

function validateArgumentRegisterConflict(
  continuation: TargetGuestRestoreContinuationDescriptor,
): void {
  if (continuation.argument0 !== undefined && continuation.resumeRegisters !== undefined) {
    fail(
      "target-guest-loader-invalid-continuation",
      "argument0 cannot be combined with a resume register bank",
    );
  }
}

function validateTargetFsBase(continuation: TargetGuestRestoreContinuationDescriptor): void {
  if (continuation.targetFsBase === undefined) {
    return;
  }
  assertHexAddress(continuation.targetFsBase, "targetFsBase");
  if (continuation.stateReportAddress === undefined) {
    fail("target-guest-loader-invalid-continuation", "targetFsBase requires a state report");
  }
}

const RESOURCE_RECIPE_VALIDATORS = {
  "close-fd": (recipe: Extract<TargetGuestRestoreResourceRecipe, { kind: "close-fd" }>) => {
    assertFd(recipe.fd, "fd");
  },
  "inherit-stdio": validateInheritedStdioRecipe,
  "reopen-file": validateReopenFileRecipe,
  "synthetic-empty-pipe": (
    recipe: Extract<TargetGuestRestoreResourceRecipe, { kind: "synthetic-empty-pipe" }>,
  ) => {
    assertFd(recipe.readFd, "readFd");
    assertOptionalFd(recipe.writeFd, "writeFd");
    assertDistinctPipeFds(recipe);
  },
  "synthetic-empty-eventfd": validateSingleFdRecipe,
  "synthetic-timerfd": validateSingleFdRecipe,
};

function validateResourceRecipe(
  recipe: TargetGuestRestoreResourceRecipe,
): TargetGuestRestoreResourceRecipe {
  RESOURCE_RECIPE_VALIDATORS[recipe.kind](recipe as never);
  return recipe;
}

function validateInheritedStdioRecipe(
  recipe: Extract<TargetGuestRestoreResourceRecipe, { kind: "inherit-stdio" }>,
): void {
  if (
    (recipe.fd !== 1 && recipe.fd !== 2) ||
    (recipe.fd === 1 && recipe.stream !== "stdout") ||
    (recipe.fd === 2 && recipe.stream !== "stderr")
  ) {
    fail("target-guest-loader-invalid-fd", "stdio fd and stream do not match");
  }
}

function validateReopenFileRecipe(
  recipe: Extract<TargetGuestRestoreResourceRecipe, { kind: "reopen-file" }>,
): void {
  assertFd(recipe.fd, "fd");
  assertNonNegative(recipe.offset, "offset");
  assertNoWhitespace(recipe.path, "path");
}

function validateSingleFdRecipe(
  recipe: Extract<
    TargetGuestRestoreResourceRecipe,
    { kind: "synthetic-empty-eventfd" | "synthetic-timerfd" }
  >,
): void {
  assertFd(recipe.fd, "fd");
}

function assertUniqueResourceFds(resources: TargetGuestRestoreResourceRecipe[]): void {
  const owners = new Map<number, string>();
  for (const resource of resources) {
    for (const fd of resourceFds(resource)) {
      const owner = owners.get(fd);
      if (owner) {
        fail(
          "target-guest-loader-invalid-fd",
          `fd ${fd} is assigned by both ${owner} and ${resource.kind}`,
        );
      }
      owners.set(fd, resource.kind);
    }
  }
}

function resourceFds(resource: TargetGuestRestoreResourceRecipe): number[] {
  if (resource.kind === "synthetic-empty-pipe") {
    return resource.writeFd === undefined ? [resource.readFd] : [resource.readFd, resource.writeFd];
  }
  return [resource.fd];
}

function validateMemoryEntry(
  entry: TargetGuestMemoryMaterializationEntry,
): TargetGuestMemoryMaterializationEntry {
  assertHexAddress(entry.targetStart, "targetStart");
  assertPositive(entry.sizeBytes, "sizeBytes");
  assertMemoryPermissions(entry.permissions);
  if (entry.kind === "copy-captured-bytes") {
    assertNonNegative(entry.sourceOffset, "sourceOffset");
  }
  return entry;
}

function validateNativeRestoreStep(
  step: TargetGuestNativeRestoreStep,
): TargetGuestNativeRestoreStep {
  switch (step.section) {
    case "stack-window-write":
      validateStackWindowWrite(step.write);
      return step;
    case "stack-window-guard":
      validateStackWindowGuard(step.guard);
      return step;
    case "return-chain-write":
      validateReturnChainWrite(step.write);
      return step;
    case "private-memory":
      validatePrivateMemoryStep(step.step);
      return step;
    case "executable-mapping":
      validateExecutableMappingStep(step.step);
      return step;
    case "signal-restore":
      validateSignalRestoreStep(step.step);
      return step;
    case "active-syscall":
      validateActiveSyscallRestoreStep(step.step);
      return step;
    case "thread-spawn":
      validateThreadSpawnStep(step.step);
      return step;
  }
}

function validateThreadSpawnStep(step: TargetGuestTwoThreadSpawnStep): void {
  if (step.action !== "spawn-target-thread") {
    fail("target-guest-loader-descriptor-invalid", "unsupported native thread action");
  }
  assertNoWhitespace(step.threadId, "threadId");
  assertHexAddress(step.stackBase, "stackBase");
  assertHexAddress(step.stackLimit, "stackLimit");
  if (BigInt(step.stackBase) >= BigInt(step.stackLimit)) {
    fail("target-guest-loader-invalid-continuation", "thread stack range is inverted");
  }
  assertHexAddress(step.registers.rip, "rip");
  assertHexAddress(step.registers.rsp, "rsp");
}

function validateStackWindowWrite(write: NativeStackWindowWrite): void {
  assertNoWhitespace(write.mapping, "mapping");
  assertHexAddress(write.targetAddress, "targetAddress");
  assertNonNegative(write.offset, "offset");
  if (write.sizeBytes !== 8) {
    fail("target-guest-loader-invalid-continuation", "stack-window writes must be u64");
  }
  assertHexAddress(write.value, "value");
  assertBytesHex(write.bytes, "bytes");
  if (!["pointer", "code-pointer", "return-address", "thread-pointer"].includes(write.kind)) {
    fail("target-guest-loader-invalid-continuation", "stack-window write kind is unsupported");
  }
}

function validateStackWindowGuard(guard: NativeStackWindowGuardMapping): void {
  assertHexAddress(guard.targetStart, "targetStart");
  assertPositive(guard.sizeBytes, "sizeBytes");
  if (guard.placement !== "below" && guard.placement !== "above") {
    fail("target-guest-loader-invalid-continuation", "stack-window guard placement is unsupported");
  }
}

function validateReturnChainWrite(write: NativeReturnChainFrameWrite): void {
  assertNoWhitespace(write.frameId, "frameId");
  assertHexAddress(write.targetAddress, "targetAddress");
  assertHexAddress(write.value, "value");
  assertBytesHex(write.bytes, "bytes");
  if (write.kind !== "caller-frame-pointer" && write.kind !== "return-address") {
    fail("target-guest-loader-invalid-continuation", "return-chain write kind is unsupported");
  }
}

function validatePrivateMemoryStep(step: TargetGuestPrivateMemoryRestoreStep): void {
  assertNoWhitespace(step.mapping, "mapping");
  assertHexAddress(step.targetStart, "targetStart");
  assertPositive(step.sizeBytes, "sizeBytes");
  if (step.action === "copy-captured-bytes") {
    assertNoWhitespace(step.sourceFile, "sourceFile");
    assertNonNegative(step.sourceOffset, "sourceOffset");
    return;
  }
  assertMemoryPermissions(step.permissions);
}

function validateExecutableMappingStep(step: TargetGuestExecutableMappingStep): void {
  if (step.action !== "map-target-executable") {
    fail("target-guest-loader-descriptor-invalid", "unsupported native executable action");
  }
  assertNoWhitespace(step.mapping, "mapping");
  assertHexAddress(step.targetStart, "targetStart");
  assertPositive(step.sizeBytes, "sizeBytes");
  assertNoWhitespace(step.path, "path");
  assertNonNegative(step.fileOffset, "fileOffset");
  if (!step.permissions.execute || step.permissions.shared || step.sourceTextReusedAsTargetCode) {
    fail("target-guest-loader-invalid-continuation", "target executable mapping is not safe");
  }
  if (!step.buildId && !step.sha256) {
    fail("target-guest-loader-invalid-continuation", "target executable mapping lacks provenance");
  }
}

function validateSignalRestoreStep(step: TargetGuestSignalRestoreStep): void {
  assertNoWhitespace(step.threadId, "threadId");
  if ("targetBlockedMasks" in step) {
    step.targetBlockedMasks.forEach((mask) => assertHexAddress(mask, "targetBlockedMasks"));
  }
}

function validateActiveSyscallRestoreStep(step: TargetGuestActiveSyscallRestoreStep): void {
  assertNoWhitespace(step.threadId, "threadId");
  if (step.action === "restore-fd-read-block") {
    assertFd(step.fd, "fd");
    assertPositive(step.countBytes, "countBytes");
    if (step.resource !== "synthetic-empty-pipe-read-end") {
      fail("target-guest-loader-invalid-continuation", "fd read resource is unsupported");
    }
    return;
  }
  assertNoWhitespace(step.remainingTime.seconds, "seconds");
  assertNonNegative(step.remainingTime.nanoseconds, "nanoseconds");
  if (step.remainingTime.nanoseconds > 999_999_999) {
    fail("target-guest-loader-invalid-continuation", "nanoseconds must be <= 999999999");
  }
  if (step.action === "rearm-sleep-timer") {
    assertNoWhitespace(step.syscallName, "syscallName");
  } else if (step.nfds !== 0 && step.nfds !== 1) {
    fail("target-guest-loader-invalid-continuation", "ppoll nfds must be 0 or 1");
  }
}

function assertBytesHex(value: string, field: string): void {
  if (!/^[0-9a-f]{16}$/i.test(value)) {
    fail("target-guest-loader-invalid-continuation", `${field} must be 8 little-endian bytes`);
  }
}

function validateTranslatedFrame(
  frame: TargetGuestTranslatedFrameDescriptor | undefined,
  continuation: TargetGuestRestoreContinuationDescriptor,
): TargetGuestTranslatedFrameDescriptor | undefined {
  if (frame === undefined) {
    if (continuation.resumeMode === "translated-frame") {
      fail("target-guest-loader-frame-unsupported", "translated resume mode requires a frame");
    }
    return undefined;
  }
  if (continuation.translatedReturnAddress === undefined) {
    fail("target-guest-loader-frame-unsupported", "translated frame requires a return address");
  }
  if (
    continuation.resumeMode === "translated-frame" &&
    continuation.stateReportAddress === undefined
  ) {
    fail("target-guest-loader-frame-unsupported", "translated resume mode requires a state report");
  }
  assertFrameShape(frame, continuation.translatedReturnAddress);
  return frame;
}

function assertFrameShape(
  frame: TargetGuestTranslatedFrameDescriptor,
  translatedReturnAddress: string,
): void {
  if (frame.kind !== "single-target-caller-frame") {
    fail("target-guest-loader-frame-unsupported", "translated frame kind is unsupported");
  }
  assertHexAddress(frame.framePointer, "framePointer");
  assertHexAddress(frame.canonicalFrameAddress, "canonicalFrameAddress");
  assertHexAddress(frame.returnAddressSlot, "returnAddressSlot");
  assertHexAddress(frame.returnAddress, "returnAddress");
  if (frame.returnAddress.toLowerCase() !== translatedReturnAddress.toLowerCase()) {
    fail("target-guest-loader-frame-unsupported", "frame return address is unresolved");
  }
  assertNoWhitespace(frame.unwindId, "unwindId");
  if (!frame.unwindId.startsWith("target:")) {
    fail("target-guest-loader-frame-unsupported", "frame unwind identity is unsupported");
  }
  validateFrameRegisters(frame.calleeSaved);
  validateFrameSlots(frame.slots);
}

function validateFrameRegisters(registers: TargetGuestTranslatedFrameRegister[]): void {
  const values = new Map<TargetGuestTranslatedFrameRegisterName, string>();
  for (const register of registers) {
    if (!isTargetFrameCalleeSavedRegister(register.register)) {
      fail("target-guest-loader-frame-unsupported", "translated frame register is unsupported");
    }
    if (values.has(register.register)) {
      fail("target-guest-loader-frame-unsupported", "duplicate translated frame register");
    }
    assertHexAddress(register.value, register.register);
    values.set(register.register, register.value);
  }
  if (values.size !== TARGET_FRAME_CALLEE_SAVED_REGISTERS.length) {
    fail("target-guest-loader-frame-unsupported", "translated frame register bank is incomplete");
  }
}

function isTargetFrameCalleeSavedRegister(
  register: string,
): register is TargetGuestTranslatedFrameRegisterName {
  return TARGET_FRAME_CALLEE_SAVED_REGISTERS.includes(
    register as TargetGuestTranslatedFrameRegisterName,
  );
}

function validateFrameSlots(slots: TargetGuestTranslatedFrameSlot[]): void {
  if (slots.length === 0) {
    fail("target-guest-loader-frame-unsupported", "translated frame slots are incomplete");
  }
  if (slots.length > TARGET_FRAME_MAX_SLOTS) {
    fail("target-guest-loader-frame-unsupported", "too many translated frame slots");
  }
  const offsets = new Set<number>();
  for (const slot of slots) {
    assertNonNegative(slot.offset, "slot offset");
    if (offsets.has(slot.offset)) {
      fail("target-guest-loader-frame-unsupported", "duplicate translated frame slot offset");
    }
    offsets.add(slot.offset);
    assertHexAddress(slot.value, "slot value");
    if (slot.classification !== "non-pointer-data") {
      fail("target-guest-loader-frame-unsupported", "pointer-bearing frame slots are unsupported");
    }
  }
}

function assertMemoryPermissions(permissions: string): void {
  if (!/^[r-][w-][-x][ps-]$/.test(permissions) || permissions.includes("x")) {
    fail("target-guest-loader-invalid-continuation", "memory permissions must be non-executable");
  }
}

function assertDistinctPipeFds(recipe: { readFd: number; writeFd?: number }): void {
  if (recipe.writeFd === recipe.readFd) {
    fail("target-guest-loader-invalid-fd", "pipe read/write fds must differ");
  }
}

function assertOptionalFd(value: number | undefined, field: string): void {
  if (value !== undefined) {
    assertFd(value, field);
  }
}

function assertFd(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1024) {
    fail("target-guest-loader-invalid-fd", `${field} must be an fd in [0, 1024]`);
  }
}

function assertPositive(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("target-guest-loader-invalid-continuation", `${field} must be positive`);
  }
}

function assertNonNegative(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("target-guest-loader-invalid-continuation", `${field} must be non-negative`);
  }
}

function assertHexAddress(value: string, field: string): void {
  if (!/^0x[0-9a-f]+$/i.test(value)) {
    fail("target-guest-loader-invalid-continuation", `${field} must be a hex address`);
  }
}

function assertNoWhitespace(value: string, field: string): void {
  if (value.length === 0 || /\s/.test(value)) {
    fail("target-guest-loader-descriptor-invalid", `${field} must be a non-empty token`);
  }
}

const SUPPORTED_RESUME_RFLAGS_MASK = 0x8d7n;
const REQUIRED_RESUME_RFLAGS_MASK = 0x2n;

function validateResumeRflags(value: string | undefined): void {
  if (value === undefined) {
    return;
  }
  assertHexAddress(value, "resumeRflags");
  const parsed = BigInt(value);
  if ((parsed & REQUIRED_RESUME_RFLAGS_MASK) !== REQUIRED_RESUME_RFLAGS_MASK) {
    fail("target-guest-loader-invalid-continuation", "resumeRflags must include reserved bit 1");
  }
  if ((parsed & ~SUPPORTED_RESUME_RFLAGS_MASK) !== 0n) {
    fail(
      "target-guest-loader-invalid-continuation",
      "resumeRflags contains unsupported non-condition bits",
    );
  }
}

const TARGET_RESUME_REGISTERS = [
  "rax",
  "rdi",
  "rsi",
  "rdx",
  "rcx",
  "r8",
  "r9",
  "r10",
  "r11",
] as const;

const TARGET_RESUME_REGISTER_FIELDS: Record<TargetGuestResumeRegisterName, string> = {
  rax: "resumeRegisterRax",
  rdi: "resumeRegisterRdi",
  rsi: "resumeRegisterRsi",
  rdx: "resumeRegisterRdx",
  rcx: "resumeRegisterRcx",
  r8: "resumeRegisterR8",
  r9: "resumeRegisterR9",
  r10: "resumeRegisterR10",
  r11: "resumeRegisterR11",
};

function parseResumeRegisters(fields: Map<string, string>): TargetGuestResumeRegisters | undefined {
  const values = TARGET_RESUME_REGISTERS.flatMap((register) => {
    const value = fields.get(TARGET_RESUME_REGISTER_FIELDS[register]);
    return value === undefined ? [] : [[register, value] as const];
  });
  if (values.length === 0) {
    return undefined;
  }
  if (values.length !== TARGET_RESUME_REGISTERS.length) {
    fail("target-guest-loader-invalid-continuation", "resume register bank is incomplete");
  }
  return Object.fromEntries(values) as TargetGuestResumeRegisters;
}

function validateResumeRegisters(registers: TargetGuestResumeRegisters | undefined): void {
  if (registers === undefined) {
    return;
  }
  for (const register of TARGET_RESUME_REGISTERS) {
    assertHexAddress(registers[register], register);
  }
}

function resumeRegisterFields(registers: TargetGuestResumeRegisters | undefined): string[] {
  return registers === undefined
    ? []
    : TARGET_RESUME_REGISTERS.map(
        (register) => `${TARGET_RESUME_REGISTER_FIELDS[register]}=${registers[register]}`,
      );
}

function optionalContinuationField(name: string, value: string | undefined): string[] {
  return value === undefined ? [] : [`${name}=${value}`];
}

function optionalTranslatedFrameField(
  frame: TargetGuestTranslatedFrameDescriptor | undefined,
): string[] {
  return frame === undefined ? [] : [serializeTranslatedFrame(frame)];
}

function serializeTranslatedFrame(frame: TargetGuestTranslatedFrameDescriptor): string {
  const registers = frameRegisterMap(frame.calleeSaved);
  return [
    `frame=${frame.kind}`,
    `framePointer=${frame.framePointer}`,
    `canonicalFrameAddress=${frame.canonicalFrameAddress}`,
    `returnAddressSlot=${frame.returnAddressSlot}`,
    `returnAddress=${frame.returnAddress}`,
    `unwindId=${frame.unwindId}`,
    ...TARGET_FRAME_CALLEE_SAVED_REGISTERS.flatMap((register) =>
      optionalFrameToken(TARGET_FRAME_REGISTER_FIELDS[register], registers.get(register)),
    ),
    ...frame.slots.flatMap((slot, index) => frameSlotTokens(slot, index)),
  ].join(" ");
}

function frameRegisterMap(
  registers: TargetGuestTranslatedFrameRegister[],
): Map<TargetGuestTranslatedFrameRegisterName, string> {
  return new Map(registers.map((register) => [register.register, register.value]));
}

function frameSlotTokens(slot: TargetGuestTranslatedFrameSlot, index: number): string[] {
  return [
    `slot${index}Offset=${slot.offset}`,
    `slot${index}Value=${slot.value}`,
    `slot${index}Class=${slot.classification}`,
  ];
}

function optionalFrameToken(name: string, value: string | number | undefined): string[] {
  return value === undefined ? [] : [`${name}=${value}`];
}

function serializeResourceRecipe(recipe: TargetGuestRestoreResourceRecipe): string {
  if (recipe.kind === "close-fd") {
    const reason = recipe.reason === undefined ? "" : ` reason=${recipe.reason}`;
    return `resource=close-fd fd=${recipe.fd}${reason}`;
  }
  if (recipe.kind === "inherit-stdio") {
    return `resource=inherit-stdio fd=${recipe.fd} stream=${recipe.stream}${serializeCloseOnExec(recipe.closeOnExec)}`;
  }
  if (recipe.kind === "reopen-file") {
    return `resource=reopen-file fd=${recipe.fd} path=${recipe.path} offset=${recipe.offset} access=${recipe.access}${serializeCloseOnExec(recipe.closeOnExec)}`;
  }
  if (recipe.kind === "synthetic-empty-pipe") {
    const writeFd = recipe.writeFd === undefined ? "" : ` writeFd=${recipe.writeFd}`;
    return `resource=synthetic-empty-pipe readFd=${recipe.readFd}${writeFd}${serializeCloseOnExec(recipe.closeOnExec)}`;
  }
  return recipe.kind === "synthetic-empty-eventfd"
    ? `resource=synthetic-empty-eventfd fd=${recipe.fd}${serializeCloseOnExec(recipe.closeOnExec)}`
    : `resource=synthetic-timerfd fd=${recipe.fd}${serializeCloseOnExec(recipe.closeOnExec)}`;
}

function serializeCloseOnExec(value: boolean | undefined): string {
  return value === undefined ? "" : ` closeOnExec=${value ? "true" : "false"}`;
}

function serializeMemoryEntry(entry: TargetGuestMemoryMaterializationEntry): string {
  const base = `mapping=${entry.mapping} targetStart=${entry.targetStart} sizeBytes=${entry.sizeBytes} permissions=${entry.permissions}`;
  if (entry.kind === "copy-captured-bytes") {
    return `memory=copy-captured-bytes ${base} sourceFile=${entry.sourceFile} sourceOffset=${entry.sourceOffset}`;
  }
  return `memory=recreate-guard ${base}`;
}

function serializeNativeRestoreStep(step: TargetGuestNativeRestoreStep): string {
  switch (step.section) {
    case "stack-window-write":
      return serializeStackWindowWrite(step.write);
    case "stack-window-guard":
      return serializeStackWindowGuard(step.guard);
    case "return-chain-write":
      return serializeReturnChainWrite(step.write);
    case "private-memory":
      return serializePrivateMemoryStep(step.step);
    case "executable-mapping":
      return serializeExecutableMappingStep(step.step);
    case "signal-restore":
      return serializeSignalRestoreStep(step.step);
    case "active-syscall":
      return serializeActiveSyscallStep(step.step);
    case "thread-spawn":
      return serializeThreadSpawnStep(step.step);
  }
}

function serializeThreadSpawnStep(step: TargetGuestTwoThreadSpawnStep): string {
  return `native=thread-spawn action=${step.action} threadId=${step.threadId} stackBase=${step.stackBase} stackLimit=${step.stackLimit} rip=${step.registers.rip} rsp=${step.registers.rsp}`;
}

function serializeStackWindowWrite(write: NativeStackWindowWrite): string {
  return `native=stack-window-write mapping=${write.mapping} targetAddress=${write.targetAddress} offset=${write.offset} sizeBytes=${write.sizeBytes} value=${write.value} bytes=${write.bytes} kind=${write.kind}`;
}

function serializeStackWindowGuard(guard: NativeStackWindowGuardMapping): string {
  return `native=stack-window-guard targetStart=${guard.targetStart} sizeBytes=${guard.sizeBytes} placement=${guard.placement}`;
}

function serializeReturnChainWrite(write: NativeReturnChainFrameWrite): string {
  return `native=return-chain-write frameId=${write.frameId} targetAddress=${write.targetAddress} value=${write.value} bytes=${write.bytes} kind=${write.kind}`;
}

function serializePrivateMemoryStep(step: TargetGuestPrivateMemoryRestoreStep): string {
  const base = `native=private-memory action=${step.action} mapping=${step.mapping} targetStart=${step.targetStart} sizeBytes=${step.sizeBytes}`;
  if (step.action === "copy-captured-bytes") {
    return `${base} sourceFile=${step.sourceFile} sourceOffset=${step.sourceOffset}`;
  }
  return `${base} permissions=${step.permissions}`;
}

function serializeExecutableMappingStep(step: TargetGuestExecutableMappingStep): string {
  return [
    `native=executable-mapping action=${step.action}`,
    `mapping=${step.mapping}`,
    `targetStart=${step.targetStart}`,
    `sizeBytes=${step.sizeBytes}`,
    `path=${step.path}`,
    `fileOffset=${step.fileOffset}`,
    `read=${step.permissions.read}`,
    `write=${step.permissions.write}`,
    `execute=${step.permissions.execute}`,
    `private=${step.permissions.private}`,
    `shared=${step.permissions.shared}`,
    ...optionalNativeToken("buildId", step.buildId),
    ...optionalNativeToken("sha256", step.sha256),
  ].join(" ");
}

function serializeSignalRestoreStep(step: TargetGuestSignalRestoreStep): string {
  const base = `native=signal-restore action=${step.action} threadId=${step.threadId}`;
  return "targetBlockedMasks" in step
    ? `${base} targetBlockedMasks=${step.targetBlockedMasks.join(",")}`
    : base;
}

function serializeActiveSyscallStep(step: TargetGuestActiveSyscallRestoreStep): string {
  if (step.action === "restore-fd-read-block") {
    return `native=active-syscall action=${step.action} threadId=${step.threadId} fd=${step.fd} countBytes=${step.countBytes} resource=${step.resource} resumeMode=${step.resumeMode}`;
  }
  const base = `native=active-syscall action=${step.action} threadId=${step.threadId} seconds=${step.remainingTime.seconds} nanoseconds=${step.remainingTime.nanoseconds} resumeMode=${step.resumeMode}`;
  return step.action === "rearm-sleep-timer"
    ? `${base} syscallName=${step.syscallName}`
    : `${base} nfds=${step.nfds} resources=${step.resources.join(",")}`;
}

function optionalNativeToken(name: string, value: string | undefined): string[] {
  return value === undefined ? [] : [`${name}=${value}`];
}

function optionalArg(flag: string, value: string | undefined): string[] {
  return value === undefined ? [] : [flag, value];
}

function resumeRegisterArgs(registers: TargetGuestResumeRegisters | undefined): string[] {
  return registers === undefined
    ? []
    : TARGET_RESUME_REGISTERS.flatMap((register) => [
        `--resume-register-${register}`,
        registers[register],
      ]);
}

function resourceToTrampolineArgs(recipe: TargetGuestRestoreResourceRecipe): string[] {
  if (recipe.kind === "close-fd") {
    return [];
  }
  if (recipe.kind === "inherit-stdio" || recipe.kind === "reopen-file") {
    return closeOnExecArgs(recipe.fd, recipe.closeOnExec);
  }
  if (recipe.kind === "synthetic-empty-pipe") {
    return [...pipeResourceArgs(recipe), ...closeOnExecArgs(recipe.readFd, recipe.closeOnExec)];
  }
  return recipe.kind === "synthetic-empty-eventfd"
    ? [
        "--synthetic-empty-eventfd",
        String(recipe.fd),
        ...closeOnExecArgs(recipe.fd, recipe.closeOnExec),
      ]
    : ["--synthetic-timerfd", String(recipe.fd), ...closeOnExecArgs(recipe.fd, recipe.closeOnExec)];
}

function pipeResourceArgs(recipe: { readFd: number; writeFd?: number }): string[] {
  const args = ["--synthetic-empty-pipe-read-fd", String(recipe.readFd)];
  if (recipe.writeFd !== undefined) {
    args.push("--synthetic-empty-pipe-write-fd", String(recipe.writeFd));
  }
  return args;
}

function closeOnExecArgs(fd: number, closeOnExec: boolean | undefined): string[] {
  return closeOnExec ? ["--set-cloexec-fd", String(fd)] : [];
}

function translatedFrameToTrampolineArgs(
  frame: TargetGuestTranslatedFrameDescriptor | undefined,
): string[] {
  if (frame === undefined) {
    return [];
  }
  const registers = frameRegisterMap(frame.calleeSaved);
  return [
    "--translated-frame-pointer",
    frame.framePointer,
    "--translated-frame-cfa",
    frame.canonicalFrameAddress,
    "--translated-frame-return-address-slot",
    frame.returnAddressSlot,
    "--translated-frame-return-address",
    frame.returnAddress,
    "--translated-frame-unwind-id",
    frame.unwindId,
    ...TARGET_FRAME_CALLEE_SAVED_REGISTERS.flatMap((register) =>
      optionalArg(`--translated-frame-callee-${register}`, registers.get(register)),
    ),
    ...frame.slots.flatMap((slot) => ["--translated-frame-slot", frameSlotSpec(slot)]),
  ];
}

function frameSlotSpec(slot: TargetGuestTranslatedFrameSlot): string {
  return `${slot.offset}:${slot.value}:${slot.classification}`;
}

function memoryToTrampolineArgs(entry: TargetGuestMemoryMaterializationEntry): string[] {
  if (entry.kind === "copy-captured-bytes") {
    return ["--materialize-memory", memorySpec(entry)];
  }
  return ["--materialize-guard", `${entry.targetStart}:${entry.sizeBytes}`];
}

function memorySpec(
  entry: Extract<TargetGuestMemoryMaterializationEntry, { kind: "copy-captured-bytes" }>,
): string {
  return [
    entry.sourceFile,
    entry.sourceOffset,
    entry.targetStart,
    entry.sizeBytes,
    entry.permissions,
  ].join(":");
}

function nativeRestoreToTrampolineArgs(step: TargetGuestNativeRestoreStep): string[] {
  switch (step.section) {
    case "stack-window-write":
      return ["--native-stack-window-write", nativeStackWindowWriteSpec(step.write)];
    case "stack-window-guard":
      return ["--native-stack-window-guard", nativeStackWindowGuardSpec(step.guard)];
    case "return-chain-write":
      return ["--native-return-chain-write", nativeReturnChainWriteSpec(step.write)];
    case "private-memory":
      return ["--native-private-memory-step", nativePrivateMemoryStepSpec(step.step)];
    case "executable-mapping":
      return ["--native-executable-mapping", nativeExecutableMappingSpec(step.step)];
    case "signal-restore":
      return ["--native-signal-restore-step", nativeSignalRestoreStepSpec(step.step)];
    case "active-syscall":
      return ["--native-active-syscall-step", nativeActiveSyscallStepSpec(step.step)];
    case "thread-spawn":
      return ["--native-thread-spawn-step", nativeThreadSpawnStepSpec(step.step)];
  }
}

function nativeThreadSpawnStepSpec(step: TargetGuestTwoThreadSpawnStep): string {
  return serializeThreadSpawnStep(step).slice("native=thread-spawn ".length).replaceAll(" ", ";");
}

function nativeStackWindowWriteSpec(write: NativeStackWindowWrite): string {
  return [write.targetAddress, write.value, write.bytes, write.kind].join(":");
}

function nativeStackWindowGuardSpec(guard: NativeStackWindowGuardMapping): string {
  return [guard.targetStart, guard.sizeBytes, guard.placement].join(":");
}

function nativeReturnChainWriteSpec(write: NativeReturnChainFrameWrite): string {
  return [write.targetAddress, write.value, write.bytes, write.kind].join(":");
}

function nativePrivateMemoryStepSpec(step: TargetGuestPrivateMemoryRestoreStep): string {
  return serializePrivateMemoryStep(step)
    .slice("native=private-memory ".length)
    .replaceAll(" ", ";");
}

function nativeExecutableMappingSpec(step: TargetGuestExecutableMappingStep): string {
  return serializeExecutableMappingStep(step)
    .slice("native=executable-mapping ".length)
    .replaceAll(" ", ";");
}

function nativeSignalRestoreStepSpec(step: TargetGuestSignalRestoreStep): string {
  return serializeSignalRestoreStep(step)
    .slice("native=signal-restore ".length)
    .replaceAll(" ", ";");
}

function nativeActiveSyscallStepSpec(step: TargetGuestActiveSyscallRestoreStep): string {
  return serializeActiveSyscallStep(step)
    .slice("native=active-syscall ".length)
    .replaceAll(" ", ";");
}

function fail(code: TargetGuestRestoreLoaderRefusalCode, message: string): never {
  throw new TargetGuestRestoreLoaderValidationError(code, message);
}
