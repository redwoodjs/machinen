import type { TargetGuestMemoryMaterializationEntry } from "./target-guest-memory-materialization.ts";

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
  translatedReturnAddress?: string;
  resumeMode?: TargetGuestRestoreResumeMode;
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

export interface TargetGuestRestoreDescriptor {
  kind: typeof TARGET_GUEST_RESTORE_DESCRIPTOR_KIND;
  targetArch: "amd64";
  continuation: TargetGuestRestoreContinuationDescriptor;
  translatedFrame?: TargetGuestTranslatedFrameDescriptor;
  resources: TargetGuestRestoreResourceRecipe[];
  memory: TargetGuestMemoryMaterializationEntry[];
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
    ...optionalContinuationField("translatedReturnAddress", continuation.translatedReturnAddress),
    ...optionalContinuationField("resumeMode", continuation.resumeMode),
    ...resumeRegisterFields(continuation.resumeRegisters),
    `timeoutSeconds=${continuation.timeoutSeconds}`,
    `stackTargetStart=${continuation.stackTargetStart}`,
    `stackSize=${continuation.stackSize}`,
    `stackPointer=${continuation.stackPointer}`,
    ...optionalTranslatedFrameField(validated.translatedFrame),
    ...validated.resources.map(serializeResourceRecipe),
    ...validated.memory.map(serializeMemoryEntry),
    "",
  ].join("\n");
}

export function parseTargetGuestRestoreDescriptor(text: string): TargetGuestRestoreDescriptor {
  const fields = new Map<string, string>();
  const resources: TargetGuestRestoreResourceRecipe[] = [];
  const memory: TargetGuestMemoryMaterializationEntry[] = [];
  let translatedFrame: TargetGuestTranslatedFrameDescriptor | undefined;
  for (const line of descriptorLines(text)) {
    if (line.startsWith("resource=")) {
      resources.push(parseResourceRecipe(line));
    } else if (line.startsWith("memory=")) {
      memory.push(parseMemoryEntry(line));
    } else if (line.startsWith("frame=")) {
      translatedFrame = parseTranslatedFrame(line);
    } else {
      const [key, value] = splitField(line);
      fields.set(key, value);
    }
  }
  return validateTargetGuestRestoreDescriptor(
    fieldsToDescriptor(fields, resources, memory, translatedFrame),
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
  const translatedFrame = validateTranslatedFrame(descriptor.translatedFrame, continuation);
  return translatedFrame === undefined
    ? { ...descriptor, continuation, resources, memory }
    : { ...descriptor, continuation, translatedFrame, resources, memory };
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
    ...optionalArg("--translated-return-address", continuation.translatedReturnAddress),
    ...optionalArg("--resume-mode", continuation.resumeMode),
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
      translatedReturnAddress: optionalField(fields, "translatedReturnAddress"),
      resumeMode: optionalField(fields, "resumeMode") as TargetGuestRestoreResumeMode | undefined,
      resumeRegisters: parseResumeRegisters(fields),
      timeoutSeconds: parseIntegerField(fields, "timeoutSeconds"),
      stackTargetStart: requiredField(fields, "stackTargetStart"),
      stackSize: parseIntegerField(fields, "stackSize"),
      stackPointer: requiredField(fields, "stackPointer"),
    },
    translatedFrame,
    resources,
    memory,
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
  if (continuation.argument0 !== undefined) {
    assertHexAddress(continuation.argument0, "argument0");
  }
  if (continuation.stateReportAddress !== undefined) {
    assertHexAddress(continuation.stateReportAddress, "stateReportAddress");
  }
  if (continuation.translatedReturnAddress !== undefined) {
    assertHexAddress(continuation.translatedReturnAddress, "translatedReturnAddress");
  }
  if (continuation.resumeMode !== undefined && continuation.resumeMode !== "translated-frame") {
    fail("target-guest-loader-invalid-continuation", "resumeMode is unsupported");
  }
  validateResumeRegisters(continuation.resumeRegisters);
  assertHexAddress(continuation.stackTargetStart, "stackTargetStart");
  assertHexAddress(continuation.stackPointer, "stackPointer");
  return continuation;
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

const TARGET_RESUME_REGISTERS = ["rax", "rsi", "rdx", "rcx", "r8", "r9", "r10", "r11"] as const;

const TARGET_RESUME_REGISTER_FIELDS: Record<TargetGuestResumeRegisterName, string> = {
  rax: "resumeRegisterRax",
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

function fail(code: TargetGuestRestoreLoaderRefusalCode, message: string): never {
  throw new TargetGuestRestoreLoaderValidationError(code, message);
}
