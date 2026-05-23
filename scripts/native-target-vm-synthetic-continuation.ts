#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { boot } from "../packages/runtime/src/index.ts";
import {
  type TargetGuestRestoreDescriptor,
  type TargetGuestRestoreResourceRecipe,
  serializeTargetGuestRestoreDescriptor,
} from "../packages/runtime/src/target-guest-restore-loader.ts";
import {
  NATIVE_ACTUAL_RESUME_TRAMPOLINE_SOURCE,
  TARGET_GUEST_RESTORE_LOADER_SOURCE,
} from "./controlled-corpus-utils.mjs";

const IMAGE_ENV = "MACHINEN_TARGET_VM_IMAGE";
const GUEST_TRAMPOLINE = "/tmp/machinen-resume-trampoline";
const GUEST_LOADER = "/tmp/machinen-target-guest-restore-loader";
const GUEST_CODE = "/tmp/machinen-target-bytes.bin";
const GUEST_DESCRIPTOR = "/tmp/machinen-target-guest-restore.desc";
const GUEST_MEMORY_DEFAULT = "/tmp/machinen-combined-native-memory.bin";
const GUEST_FD_FILE_DEFAULT = "/tmp/machinen-combined-fd.txt";
const LOADER_PREFIX = "MACHINEN_TARGET_GUEST_RESTORE_LOADER ";
const ACTUAL_RESUME_PREFIX = "MACHINEN_ACTUAL_RESUME_TRAMPOLINE ";

type StateConsumptionStatus = "passed" | "failed";

interface StateConsumptionResourceStatus {
  kind: string;
  status: StateConsumptionStatus;
}

interface StateConsumptionEvent {
  status?: StateConsumptionStatus;
  resourceStatuses?: StateConsumptionResourceStatus[];
}

interface ReturnChainEvent {
  status?: StateConsumptionStatus;
  translatedReturnAddress?: string;
}

interface FrameRestorationEvent {
  status?: StateConsumptionStatus;
  framePointer?: string;
}

interface RegisterRestoreEvent {
  status?: StateConsumptionStatus;
}

interface RflagsRestoreEvent {
  status?: StateConsumptionStatus;
}

interface ResumePathEvent {
  status?: StateConsumptionStatus;
  mode?: string;
}

interface Args {
  codeFile?: string;
  descriptorFile?: string;
  memoryFile?: string;
  guestMemoryFile: string;
  fdFile?: string;
  guestFdFile: string;
  image?: string;
  json: boolean;
  keep: boolean;
  timeoutSeconds: number;
  entryAddress: string;
  stackTargetStart: string;
  stackSize: string;
  stackPointer: string;
  syntheticEmptyPipeReadFd?: string;
  syntheticEmptyPipeWriteFd?: string;
  syntheticEmptyEventFd?: string;
  syntheticTimerFd?: string;
  expectReturnValue?: string;
}

function usage(): never {
  console.error(
    "usage: tsx scripts/native-target-vm-synthetic-continuation.ts verify " +
      "--code-file path [--descriptor-file path] [--memory-file path] " +
      "[--fd-file path] [--image rootfs.tar.gz] [--entry-address hex] " +
      "[--stack-target-start hex] [--stack-size n] [--stack-pointer hex] [--json]",
  );
  process.exit(2);
}

function flagReader(argv: string[]): (flag: string) => string | undefined {
  return (flag) => readFlagValue(argv, flag);
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.findIndex((arg) => arg === flag);
  return index < 0 ? undefined : requiredFlagValue(argv[index + 1]);
}

function requiredFlagValue(value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    usage();
  }
  return value;
}

function parseArgs(argv: string[]): Args {
  const read = flagReader(argv);
  return {
    codeFile: read("--code-file"),
    descriptorFile: read("--descriptor-file"),
    memoryFile: read("--memory-file"),
    guestMemoryFile: withDefault(read("--guest-memory-file"), GUEST_MEMORY_DEFAULT),
    fdFile: read("--fd-file"),
    guestFdFile: withDefault(read("--guest-fd-file"), GUEST_FD_FILE_DEFAULT),
    image: read("--image") ?? process.env[IMAGE_ENV],
    json: argv.includes("--json"),
    keep: argv.includes("--keep"),
    timeoutSeconds: Number(withDefault(read("--timeout-seconds"), "5")),
    entryAddress: withDefault(read("--entry-address"), "0x700300000000"),
    stackTargetStart: withDefault(read("--stack-target-start"), "0x500000000000"),
    stackSize: withDefault(read("--stack-size"), "65536"),
    stackPointer: withDefault(read("--stack-pointer"), "0x500000010000"),
    syntheticEmptyPipeReadFd: read("--synthetic-empty-pipe-read-fd"),
    syntheticEmptyPipeWriteFd: read("--synthetic-empty-pipe-write-fd"),
    syntheticEmptyEventFd: read("--synthetic-empty-eventfd"),
    syntheticTimerFd: read("--synthetic-timerfd"),
    expectReturnValue: read("--expect-return-value"),
  };
}

function withDefault(value: string | undefined, fallback: string): string {
  return value ?? fallback;
}

function compileHelper(outDir: string, source: string, name: string): string {
  const out = join(outDir, name);
  execFileSync("cc", ["-O2", "-Wall", "-Wextra", source, "-o", out], { stdio: "pipe" });
  return out;
}

async function runTargetVmProof(args: Args) {
  const skip = skipReason(args);
  if (skip) {
    return { skipped: true, reason: skip };
  }
  const workspace = mkdtempSync(join(tmpdir(), "machinen-target-vm-synthetic-"));
  const trampoline = compileHelper(
    workspace,
    NATIVE_ACTUAL_RESUME_TRAMPOLINE_SOURCE,
    "machinen-native-actual-resume-trampoline",
  );
  const loader = compileHelper(
    workspace,
    TARGET_GUEST_RESTORE_LOADER_SOURCE,
    "machinen-target-guest-restore-loader",
  );
  const vm = await bootTargetVm(args.image!);
  await waitForTargetGuestBoot();
  try {
    return await executeTargetVmProof(args, { trampoline, loader }, vm);
  } finally {
    await killUnlessKept(vm, args.keep);
  }
}

function waitForTargetGuestBoot(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1000));
}

function skipReason(args: Args): string | undefined {
  return firstReason([
    hostSkipReason(),
    missingFileReason(args.codeFile, "--code-file"),
    missingOptionalFileReason(args.descriptorFile, "--descriptor-file"),
    missingOptionalFileReason(args.memoryFile, "--memory-file"),
    missingOptionalFileReason(args.fdFile, "--fd-file"),
    missingFileReason(args.image, IMAGE_ENV),
  ]);
}

function firstReason(reasons: Array<string | undefined>): string | undefined {
  return reasons.find((reason) => reason !== undefined);
}

function hostSkipReason(): string | undefined {
  const supported = process.platform === "linux" && process.arch === "x64";
  return supported ? undefined : "target VM synthetic proof requires Linux/amd64 host";
}

function missingFileReason(path: string | undefined, label: string): string | undefined {
  return path && existsSync(path) ? undefined : `${label} must point at an existing file`;
}

function missingOptionalFileReason(path: string | undefined, label: string): string | undefined {
  return path === undefined ? undefined : missingFileReason(path, label);
}

async function bootTargetVm(image: string) {
  return await boot({
    image: resolve(image),
    name: `target-vm-synthetic-${process.pid}`,
    cmd: ["/bin/sleep", "infinity"],
    snapshot: false,
    vmmEnv: {
      ...process.env,
      MACHINEN_GUEST_ARCH: "amd64",
      MACHINEN_SKIP_GUEST_HOSTNAME: "1",
    },
  });
}

async function executeTargetVmProof(
  args: Args,
  helpers: { trampoline: string; loader: string },
  vm: Awaited<ReturnType<typeof boot>>,
) {
  await stageTargetGuestInputs(args, helpers, vm);
  const result = await vm.execRaw(targetLoaderCommand(), {
    execTimeoutMs: (args.timeoutSeconds + 20) * 1000,
  });
  return targetExecutionSummary(args, result);
}

function targetExecutionSummary(
  args: Args,
  result: { exitCode: number; stdout: string; stderr: string },
) {
  const events = targetExecutionEvents(result.stdout);
  return {
    ...targetSummary(args),
    ...events,
    ...targetStateConsumptionFields(events.stateConsumption),
    ...targetReturnChainFields(events.returnChain),
    ...targetFrameRestorationFields(events.frameRestoration),
    ...targetRegisterRestoreFields(events.registerRestore),
    ...targetRflagsRestoreFields(events.rflagsRestore),
    ...targetResumePathFields(events.resumePath),
    targetVerifierResult: targetVerifierResult(args, result.exitCode, events),
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    migrationCompleted: result.exitCode === 0 && events.descriptorGateCompleted,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
  };
}

function targetStateConsumptionFields(stateConsumption: StateConsumptionEvent | undefined) {
  return {
    targetStateConsumptionResult: stateConsumption?.status,
    targetResourceStatuses: stateConsumption?.resourceStatuses,
  };
}

function targetReturnChainFields(returnChain: ReturnChainEvent | undefined) {
  return {
    targetReturnChainResult: returnChain?.status,
    targetTranslatedReturnAddress: returnChain?.translatedReturnAddress,
  };
}

function targetFrameRestorationFields(frameRestoration: FrameRestorationEvent | undefined) {
  return {
    targetFrameRestoreResult: frameRestoration?.status,
    targetTranslatedFramePointer: frameRestoration?.framePointer,
  };
}

function targetRegisterRestoreFields(registerRestore: RegisterRestoreEvent | undefined) {
  return {
    targetRegisterRestoreResult: registerRestore?.status,
  };
}

function targetRflagsRestoreFields(rflagsRestore: RflagsRestoreEvent | undefined) {
  return {
    targetRflagsRestoreResult: rflagsRestore?.status,
  };
}

function targetResumePathFields(resumePath: ResumePathEvent | undefined) {
  return {
    targetResumePathResult: resumePath?.status,
    targetResumePathMode: resumePath?.mode,
  };
}

function targetExecutionEvents(stdout: string) {
  const descriptorGateCompleted = loaderCompleted(stdout);
  const actualResumeEvent = parseActualResumeEvent(stdout);
  return {
    descriptorGateCompleted,
    actualResumeEvent,
    stateConsumption: parseStateConsumption(actualResumeEvent),
    returnChain: parseReturnChain(actualResumeEvent),
    frameRestoration: parseFrameRestoration(actualResumeEvent),
    registerRestore: parseRegisterRestore(actualResumeEvent),
    rflagsRestore: parseRflagsRestore(actualResumeEvent),
    resumePath: parseResumePath(actualResumeEvent),
  };
}

function targetVerifierResult(
  args: Args,
  exitCode: number,
  events: ReturnType<typeof targetExecutionEvents>,
): "passed" | "failed" {
  return targetVerifierPassed(
    args,
    exitCode,
    events.descriptorGateCompleted,
    events.actualResumeEvent,
    events.stateConsumption,
    events.returnChain,
    events.frameRestoration,
    events.registerRestore,
    events.rflagsRestore,
    events.resumePath,
  )
    ? "passed"
    : "failed";
}

async function stageTargetGuestInputs(
  args: Args,
  helpers: { trampoline: string; loader: string },
  vm: Awaited<ReturnType<typeof boot>>,
): Promise<void> {
  const codeSize = statSync(args.codeFile!).size;
  await vm.writeFile(GUEST_TRAMPOLINE, readFileSync(helpers.trampoline), { mode: 0o755 });
  await vm.writeFile(GUEST_LOADER, readFileSync(helpers.loader), { mode: 0o755 });
  await vm.writeFile(GUEST_CODE, readFileSync(args.codeFile!));
  await writeOptionalGuestFiles(args, vm);
  await vm.writeFile(GUEST_DESCRIPTOR, descriptorText(args, codeSize));
}

async function writeOptionalGuestFiles(
  args: Args,
  vm: Awaited<ReturnType<typeof boot>>,
): Promise<void> {
  for (const file of optionalGuestFiles(args)) {
    await vm.writeFile(file.guest, readFileSync(file.host));
  }
}

function optionalGuestFiles(args: Args): Array<{ host: string; guest: string }> {
  return [
    optionalGuestFile(args.memoryFile, args.guestMemoryFile),
    optionalGuestFile(args.fdFile, args.guestFdFile),
  ].filter((file) => file !== undefined);
}

function optionalGuestFile(
  host: string | undefined,
  guest: string,
): { host: string; guest: string } | undefined {
  return host ? { host, guest } : undefined;
}

function targetSummary(args: Args) {
  return {
    phase: "target-vm-synthetic-continuation",
    targetVmAttempted: true,
    targetGuestLoaderUsed: true,
    targetArch: "amd64",
    codeFile: resolve(args.codeFile!),
    codeFileBasename: basename(args.codeFile!),
    descriptorFile: optionalResolve(args.descriptorFile),
    memoryFile: optionalResolve(args.memoryFile),
    fdFile: optionalResolve(args.fdFile),
  };
}

function optionalResolve(path: string | undefined): string | undefined {
  return path ? resolve(path) : undefined;
}

function descriptorText(args: Args, codeSize: number): string {
  return args.descriptorFile
    ? readFileSync(args.descriptorFile, "utf8")
    : serializeTargetGuestRestoreDescriptor(targetDescriptor(args, codeSize));
}

function loaderCompleted(stdout: string): boolean {
  const payload = prefixedJson(stdout, LOADER_PREFIX) as
    | { status?: string; exitCode?: number }
    | undefined;
  return payload?.status === "completed" && payload.exitCode === 0;
}

function parseActualResumeEvent(stdout: string): Record<string, unknown> | undefined {
  return prefixedJson(stdout, ACTUAL_RESUME_PREFIX) as Record<string, unknown> | undefined;
}

function prefixedJson(stdout: string, prefix: string): unknown | undefined {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  if (!line) {
    return undefined;
  }
  try {
    return JSON.parse(line.slice(prefix.length));
  } catch {
    return undefined;
  }
}

function targetVerifierPassed(
  args: Args,
  exitCode: number,
  descriptorGateCompleted: boolean,
  actualResumeEvent: Record<string, unknown> | undefined,
  stateConsumption: StateConsumptionEvent | undefined,
  returnChain: ReturnChainEvent | undefined,
  frameRestoration: FrameRestorationEvent | undefined,
  registerRestore: RegisterRestoreEvent | undefined,
  rflagsRestore: RflagsRestoreEvent | undefined,
  resumePath: ResumePathEvent | undefined,
): boolean {
  return [
    targetProcessCompleted(exitCode, descriptorGateCompleted),
    targetStateConsumed(stateConsumption),
    targetReturnChained(returnChain),
    targetFrameRestored(frameRestoration),
    targetRegistersRestored(registerRestore),
    targetRflagsRestored(rflagsRestore),
    targetResumePathPassed(resumePath),
    targetReturnValueMatched(args, actualResumeEvent),
  ].every(Boolean);
}

function targetProcessCompleted(exitCode: number, descriptorGateCompleted: boolean): boolean {
  return descriptorGateCompleted && exitCode === 0;
}

function targetStateConsumed(stateConsumption: StateConsumptionEvent | undefined): boolean {
  return stateConsumption === undefined || stateConsumption.status === "passed";
}

function targetReturnChained(returnChain: ReturnChainEvent | undefined): boolean {
  return returnChain === undefined || returnChain.status === "passed";
}

function targetFrameRestored(frameRestoration: FrameRestorationEvent | undefined): boolean {
  return frameRestoration === undefined || frameRestoration.status === "passed";
}

function targetRegistersRestored(registerRestore: RegisterRestoreEvent | undefined): boolean {
  return registerRestore === undefined || registerRestore.status === "passed";
}

function targetRflagsRestored(rflagsRestore: RflagsRestoreEvent | undefined): boolean {
  return rflagsRestore === undefined || rflagsRestore.status === "passed";
}

function targetResumePathPassed(resumePath: ResumePathEvent | undefined): boolean {
  return resumePath === undefined || resumePath.status === "passed";
}

function targetReturnValueMatched(
  args: Args,
  actualResumeEvent: Record<string, unknown> | undefined,
): boolean {
  return args.expectReturnValue === undefined
    ? true
    : actualResumeReturnedExpected(actualResumeEvent, args.expectReturnValue);
}

function parseStateConsumption(
  actualResumeEvent: Record<string, unknown> | undefined,
): StateConsumptionEvent | undefined {
  const value = actualResumeEvent?.stateConsumption;
  return isStateConsumptionEvent(value) ? value : undefined;
}

function isStateConsumptionEvent(value: unknown): value is StateConsumptionEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const status = (value as { status?: unknown }).status;
  return status === "passed" || status === "failed";
}

function parseReturnChain(
  actualResumeEvent: Record<string, unknown> | undefined,
): ReturnChainEvent | undefined {
  const value = actualResumeEvent?.returnChain;
  return isStateConsumptionEvent(value) ? value : undefined;
}

function parseFrameRestoration(
  actualResumeEvent: Record<string, unknown> | undefined,
): FrameRestorationEvent | undefined {
  const value = actualResumeEvent?.frameRestoration;
  return isStateConsumptionEvent(value) ? value : undefined;
}

function parseRegisterRestore(
  actualResumeEvent: Record<string, unknown> | undefined,
): RegisterRestoreEvent | undefined {
  const value = actualResumeEvent?.registerRestore;
  return isStateConsumptionEvent(value) ? value : undefined;
}

function parseRflagsRestore(
  actualResumeEvent: Record<string, unknown> | undefined,
): RflagsRestoreEvent | undefined {
  const value = actualResumeEvent?.rflagsRestore;
  return isStateConsumptionEvent(value) ? value : undefined;
}

function parseResumePath(
  actualResumeEvent: Record<string, unknown> | undefined,
): ResumePathEvent | undefined {
  const value = actualResumeEvent?.resumePath;
  return isStateConsumptionEvent(value) ? value : undefined;
}

function actualResumeReturnedExpected(
  actualResumeEvent: Record<string, unknown> | undefined,
  expectedReturnValue: string,
): boolean {
  return (
    actualResumeEvent?.status === "returned" &&
    actualResumeEvent.returnValue === expectedReturnValue
  );
}

async function killUnlessKept(vm: Awaited<ReturnType<typeof boot>>, keep: boolean): Promise<void> {
  await (keep ? Promise.resolve() : vm.kill());
}

function targetLoaderCommand(): string {
  return `${GUEST_LOADER} --descriptor ${GUEST_DESCRIPTOR} --trampoline ${GUEST_TRAMPOLINE}`;
}

function targetDescriptor(args: Args, codeSize: number): TargetGuestRestoreDescriptor {
  return {
    kind: "machinen.target-guest-restore",
    targetArch: "amd64",
    continuation: {
      codeFile: GUEST_CODE,
      fileOffset: 0,
      codeSize,
      targetAddress: args.entryAddress,
      timeoutSeconds: args.timeoutSeconds,
      stackTargetStart: args.stackTargetStart,
      stackSize: Number(args.stackSize),
      stackPointer: args.stackPointer,
    },
    resources: resourceRecipes(args),
    memory: [],
  };
}

function resourceRecipes(args: Args): TargetGuestRestoreResourceRecipe[] {
  return [pipeRecipe(args), eventfdRecipe(args), timerfdRecipe(args)].filter(
    (recipe) => recipe !== undefined,
  );
}

function pipeRecipe(args: Args): TargetGuestRestoreResourceRecipe | undefined {
  return args.syntheticEmptyPipeReadFd
    ? {
        kind: "synthetic-empty-pipe",
        readFd: Number(args.syntheticEmptyPipeReadFd),
        writeFd: optionalNumber(args.syntheticEmptyPipeWriteFd),
      }
    : undefined;
}

function eventfdRecipe(args: Args): TargetGuestRestoreResourceRecipe | undefined {
  return args.syntheticEmptyEventFd
    ? { kind: "synthetic-empty-eventfd", fd: Number(args.syntheticEmptyEventFd) }
    : undefined;
}

function timerfdRecipe(args: Args): TargetGuestRestoreResourceRecipe | undefined {
  return args.syntheticTimerFd
    ? { kind: "synthetic-timerfd", fd: Number(args.syntheticTimerFd) }
    : undefined;
}

function optionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

const args = parseArgs(process.argv.slice(2));
const summary = await runTargetVmProof(args);
if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
} else if ("skipped" in summary) {
  console.log(`native-target-vm-synthetic-continuation: skipped ${summary.reason}`);
} else {
  console.log(
    `native-target-vm-synthetic-continuation: exit=${summary.exitCode} migrationCompleted=${summary.migrationCompleted}`,
  );
}
