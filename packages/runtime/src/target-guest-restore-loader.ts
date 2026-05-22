export const TARGET_GUEST_RESTORE_DESCRIPTOR_KIND = "machinen.target-guest-restore";

export type TargetGuestRestoreLoaderRefusalCode =
  | "target-guest-loader-descriptor-invalid"
  | "target-guest-loader-target-arch-unsupported"
  | "target-guest-loader-resource-unsupported"
  | "target-guest-loader-invalid-fd"
  | "target-guest-loader-invalid-continuation";

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
  | { kind: "synthetic-empty-pipe"; readFd: number; writeFd?: number }
  | { kind: "synthetic-empty-eventfd"; fd: number };

export interface TargetGuestRestoreContinuationDescriptor {
  codeFile: string;
  fileOffset: number;
  codeSize: number;
  targetAddress: string;
  timeoutSeconds: number;
  stackTargetStart: string;
  stackSize: number;
  stackPointer: string;
}

export interface TargetGuestRestoreDescriptor {
  kind: typeof TARGET_GUEST_RESTORE_DESCRIPTOR_KIND;
  targetArch: "amd64";
  continuation: TargetGuestRestoreContinuationDescriptor;
  resources: TargetGuestRestoreResourceRecipe[];
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
    `timeoutSeconds=${continuation.timeoutSeconds}`,
    `stackTargetStart=${continuation.stackTargetStart}`,
    `stackSize=${continuation.stackSize}`,
    `stackPointer=${continuation.stackPointer}`,
    ...validated.resources.map(serializeResourceRecipe),
    "",
  ].join("\n");
}

export function parseTargetGuestRestoreDescriptor(text: string): TargetGuestRestoreDescriptor {
  const fields = new Map<string, string>();
  const resources: TargetGuestRestoreResourceRecipe[] = [];
  for (const line of descriptorLines(text)) {
    if (line.startsWith("resource=")) {
      resources.push(parseResourceRecipe(line));
    } else {
      const [key, value] = splitField(line);
      fields.set(key, value);
    }
  }
  return validateTargetGuestRestoreDescriptor(fieldsToDescriptor(fields, resources));
}

export function validateTargetGuestRestoreDescriptor(
  descriptor: TargetGuestRestoreDescriptor,
): TargetGuestRestoreDescriptor {
  assertDescriptorHeader(descriptor);
  const continuation = validateContinuation(descriptor.continuation);
  const resources = descriptor.resources.map(validateResourceRecipe);
  return { ...descriptor, continuation, resources };
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
    "--timeout-seconds",
    String(continuation.timeoutSeconds),
    "--stack-target-start",
    continuation.stackTargetStart,
    "--stack-size",
    String(continuation.stackSize),
    "--stack-pointer",
    continuation.stackPointer,
    ...validated.resources.flatMap(resourceToTrampolineArgs),
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
): TargetGuestRestoreDescriptor {
  return {
    kind: requiredField(fields, "kind") as typeof TARGET_GUEST_RESTORE_DESCRIPTOR_KIND,
    targetArch: requiredField(fields, "targetArch") as "amd64",
    continuation: {
      codeFile: requiredField(fields, "codeFile"),
      fileOffset: parseIntegerField(fields, "fileOffset"),
      codeSize: parseIntegerField(fields, "codeSize"),
      targetAddress: requiredField(fields, "targetAddress"),
      timeoutSeconds: parseIntegerField(fields, "timeoutSeconds"),
      stackTargetStart: requiredField(fields, "stackTargetStart"),
      stackSize: parseIntegerField(fields, "stackSize"),
      stackPointer: requiredField(fields, "stackPointer"),
    },
    resources,
  };
}

function requiredField(fields: Map<string, string>, key: string): string {
  return fields.get(key) ?? fail("target-guest-loader-descriptor-invalid", `${key} is required`);
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

function resourceFromFields(
  kind: string,
  fields: Map<string, string>,
): TargetGuestRestoreResourceRecipe {
  if (kind === "synthetic-empty-pipe") {
    return {
      kind,
      readFd: parseResourceInteger(fields, "readFd"),
      writeFd: optionalResourceInteger(fields, "writeFd"),
    };
  }
  if (kind === "synthetic-empty-eventfd") {
    return { kind, fd: parseResourceInteger(fields, "fd") };
  }
  return fail("target-guest-loader-resource-unsupported", `unsupported resource recipe: ${kind}`);
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

function requiredResourceField(fields: Map<string, string>, key: string): string {
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
  assertHexAddress(continuation.stackTargetStart, "stackTargetStart");
  assertHexAddress(continuation.stackPointer, "stackPointer");
  return continuation;
}

function validateResourceRecipe(
  recipe: TargetGuestRestoreResourceRecipe,
): TargetGuestRestoreResourceRecipe {
  if (recipe.kind === "synthetic-empty-pipe") {
    assertFd(recipe.readFd, "readFd");
    assertOptionalFd(recipe.writeFd, "writeFd");
    assertDistinctPipeFds(recipe);
    return recipe;
  }
  if (recipe.kind === "synthetic-empty-eventfd") {
    assertFd(recipe.fd, "fd");
    return recipe;
  }
  return fail("target-guest-loader-resource-unsupported", "unsupported resource recipe");
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

function serializeResourceRecipe(recipe: TargetGuestRestoreResourceRecipe): string {
  if (recipe.kind === "synthetic-empty-pipe") {
    const writeFd = recipe.writeFd === undefined ? "" : ` writeFd=${recipe.writeFd}`;
    return `resource=synthetic-empty-pipe readFd=${recipe.readFd}${writeFd}`;
  }
  return `resource=synthetic-empty-eventfd fd=${recipe.fd}`;
}

function resourceToTrampolineArgs(recipe: TargetGuestRestoreResourceRecipe): string[] {
  if (recipe.kind === "synthetic-empty-pipe") {
    return pipeResourceArgs(recipe);
  }
  return ["--synthetic-empty-eventfd", String(recipe.fd)];
}

function pipeResourceArgs(recipe: { readFd: number; writeFd?: number }): string[] {
  const args = ["--synthetic-empty-pipe-read-fd", String(recipe.readFd)];
  if (recipe.writeFd !== undefined) {
    args.push("--synthetic-empty-pipe-write-fd", String(recipe.writeFd));
  }
  return args;
}

function fail(code: TargetGuestRestoreLoaderRefusalCode, message: string): never {
  throw new TargetGuestRestoreLoaderValidationError(code, message);
}
