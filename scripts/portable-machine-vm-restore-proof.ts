#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  completePortableMachineVmRestoreProof,
  planPortableMachineTargetRestoreDescriptor,
  planPortableMachineVmRestoreProof,
} from "../packages/runtime/src/portable-machine-restore-proof.ts";
import {
  NATIVE_PROCESS_IMAGE_FILES,
  type NativeMemoryMapping,
  type NativeProcessResource,
} from "../packages/runtime/src/native-process-image.ts";
import { planNativeRealUtilityContinuationAttempt } from "../packages/runtime/src/native-real-utility-continuation.ts";
import { planNativeTargetFdTable } from "../packages/runtime/src/native-resource-translation.ts";
import type { NativeRealUtilityTargetModule } from "../packages/runtime/src/native-real-utility-code-map.ts";
import { materializeNativeTargetModuleBytes } from "../packages/runtime/src/native-target-module-bytes.ts";
import { matchNativeTargetUnwindFrame } from "../packages/runtime/src/native-target-unwind.ts";
import { validatePortableMachineSnapshotBundle } from "../packages/runtime/src/portable-machine-snapshot.ts";
import { planTargetGuestMemoryMaterialization } from "../packages/runtime/src/target-guest-memory-materialization.ts";
import { serializeTargetGuestRestoreDescriptor } from "../packages/runtime/src/target-guest-restore-loader.ts";
import { FINAL_JUMP_EXPECTED_RETURN, FINAL_JUMP_RETURN_MARKER } from "./native-final-jump-utils.ts";

interface Args {
  bundleDir?: string;
  targetCodeFile?: string;
  image?: string;
  json: boolean;
  combinedDescriptor: boolean;
  realUtilityContinuation: boolean;
  syntheticEmptyPipeReadFd?: string;
  syntheticEmptyPipeWriteFd?: string;
  syntheticEmptyEventFd?: string;
  syntheticTimerFd?: string;
}

interface TargetInvocation {
  descriptorFile?: string;
  memoryFile?: string;
  fdFile?: string;
  descriptorMemoryEntryCount?: number;
  descriptorFdRecipeCount?: number;
  descriptorResourceKinds?: string[];
  expectedReturnValue?: string;
  targetContinuationKind?: "generated-verifier" | "real-utility";
  targetModuleBytesSource?: string;
  targetTranslatedReturnAddress?: string;
}

interface CombinedDescriptorContext {
  targetDir: string;
  targetCodeFile: string;
  descriptorFile: string;
  memoryFile: string;
  fdFile: string;
  memorySizeBytes: number;
  mapping: NativeMemoryMapping;
}

interface PreparedTargetContinuation {
  kind: "generated-verifier" | "real-utility";
  bytes: Buffer;
  argument0?: string;
  stateReportAddress?: string;
  translatedReturnAddress?: string;
  expectedReturnValue?: string;
  targetModuleBytesSource?: string;
}

const GUEST_CODE = "/tmp/machinen-target-bytes.bin";
const GUEST_MEMORY = "/tmp/machinen-combined-native-memory.bin";
const GUEST_FD_FILE = "/tmp/machinen-combined-fd.txt";
const PROOF_MEMORY_TARGET = "0x600000000000";
const PROOF_MEMORY_SIZE = 4096;
const PROOF_CLOSED_FD = 3;
const PROOF_STDOUT_FD = 1;
const PROOF_FILE_FD = 7;
const PROOF_PIPE_READ_FD = 8;
const PROOF_PIPE_WRITE_FD = 9;
const PROOF_EVENT_FD = 10;
const PROOF_TIMER_FD = 11;
const PROOF_FD_BYTES = Buffer.from("FD");
const STATE_CONSUMPTION_MARKER = 0x5354415445434f4en;
const STATE_CHECK_MEMORY = 0x01;
const STATE_CHECK_STDIO = 0x02;
const STATE_CHECK_CLOSE_FD = 0x04;
const STATE_CHECK_REOPEN_FILE = 0x08;
const STATE_CHECK_PIPE = 0x10;
const STATE_CHECK_EVENTFD = 0x20;
const STATE_CHECK_TIMERFD = 0x40;

function usage(): never {
  console.error(
    "usage: tsx scripts/portable-machine-vm-restore-proof.ts verify " +
      "--bundle-dir path --target-code-file path [--image rootfs.tar.gz] " +
      "[--combined-descriptor] [--real-utility-continuation] [--json]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  return argsFromReader((flag) => readFlag(argv, flag), argv);
}

function argsFromReader(read: (flag: string) => string | undefined, argv: string[]): Args {
  return {
    bundleDir: read("--bundle-dir"),
    targetCodeFile: read("--target-code-file"),
    image: read("--image") ?? process.env.MACHINEN_TARGET_VM_IMAGE,
    json: argv.includes("--json"),
    combinedDescriptor: argv.includes("--combined-descriptor"),
    realUtilityContinuation: argv.includes("--real-utility-continuation"),
    syntheticEmptyPipeReadFd: read("--synthetic-empty-pipe-read-fd"),
    syntheticEmptyPipeWriteFd: read("--synthetic-empty-pipe-write-fd"),
    syntheticEmptyEventFd: read("--synthetic-empty-eventfd"),
    syntheticTimerFd: read("--synthetic-timerfd"),
  };
}

function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.findIndex((candidate) => candidate === flag);
  return index < 0 ? undefined : requiredArg(argv[index + 1]);
}

function requiredArg(value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    usage();
  }
  return value;
}

function runProof(args: Args) {
  const plan = planPortableMachineVmRestoreProof({
    bundleDir: args.bundleDir,
    targetCodeFile: args.targetCodeFile,
    targetImage: args.image,
  });
  return plan.state === "ready" ? runReadyProof(args, plan) : plan;
}

function runReadyProof(args: Args, plan: ReturnType<typeof planPortableMachineVmRestoreProof>) {
  const targetSkip = targetVmSkipReason(args.image);
  if (targetSkip) {
    return { ...plan, state: "skipped" as const, skipReason: targetSkip };
  }
  const prepared = args.combinedDescriptor ? prepareCombinedDescriptor(args, plan) : undefined;
  if (isRestorePlan(prepared)) {
    return prepared;
  }
  return runTargetProof(args, planWithDescriptorDetails(plan, prepared), prepared);
}

function isRestorePlan(
  prepared: TargetInvocation | ReturnType<typeof planPortableMachineVmRestoreProof> | undefined,
): prepared is ReturnType<typeof planPortableMachineVmRestoreProof> {
  return prepared !== undefined && "state" in prepared;
}

function planWithDescriptorDetails(
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
  invocation: TargetInvocation | undefined,
): ReturnType<typeof planPortableMachineVmRestoreProof> {
  return invocation
    ? {
        ...plan,
        descriptorMemoryEntryCount: invocation.descriptorMemoryEntryCount,
        descriptorFdRecipeCount: invocation.descriptorFdRecipeCount,
        descriptorResourceKinds: invocation.descriptorResourceKinds,
        targetContinuationKind: invocation.targetContinuationKind,
        targetModuleBytesSource: invocation.targetModuleBytesSource,
        targetStateConsumptionResult:
          invocation.targetContinuationKind === "real-utility" ? "pending" : undefined,
        targetReturnChainResult:
          invocation.targetContinuationKind === "real-utility" ? "pending" : undefined,
        targetTranslatedReturnAddress: invocation.targetTranslatedReturnAddress,
        targetVerifierResult: "pending",
      }
    : plan;
}

function prepareCombinedDescriptor(
  args: Args,
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
): TargetInvocation | ReturnType<typeof planPortableMachineVmRestoreProof> {
  const context = combinedDescriptorContext(args, plan);
  if (isRestorePlan(context)) {
    return context;
  }
  writeFileSync(context.fdFile, PROOF_FD_BYTES);
  const targetContinuation = prepareTargetContinuation(
    args,
    context.targetDir,
    context.memoryFile,
    context.mapping,
    plan,
  );
  if (isRestorePlan(targetContinuation)) {
    return targetContinuation;
  }
  writeFileSync(context.targetCodeFile, targetContinuation.bytes);

  const descriptorPlan = planPortableMachineTargetRestoreDescriptor({
    continuation: continuationDescriptor(
      context.targetCodeFile,
      targetContinuation.argument0,
      targetContinuation.stateReportAddress,
      targetContinuation.translatedReturnAddress,
    ),
    fdTable: proofFdTable(),
    memory: proofMemoryPlan(context),
  });
  if (descriptorPlan.state === "refused") {
    const first = descriptorPlan.refusals[0]!;
    return refusedPlan(plan, first.code, first.message);
  }
  writeFileSync(
    context.descriptorFile,
    serializeTargetGuestRestoreDescriptor(descriptorPlan.descriptor),
  );
  return targetInvocation(context, descriptorPlan, targetContinuation);
}

function combinedDescriptorContext(
  args: Args,
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
): CombinedDescriptorContext | ReturnType<typeof planPortableMachineVmRestoreProof> {
  const bundle = validatePortableMachineSnapshotBundle(args.bundleDir!);
  const memoryFile = join(bundle.nativeProcessImage.rootDir!, NATIVE_PROCESS_IMAGE_FILES.memory);
  const memorySizeBytes = statSync(memoryFile).size;
  const mapping = selectProofMemoryMapping(
    bundle.nativeProcessImage.mappings.mappings,
    memorySizeBytes,
  );
  if (!mapping) {
    return refusedPlan(
      plan,
      "mapping-ambiguous",
      "portable machine proof needs one safe captured writable memory page",
    );
  }
  const context = combinedDescriptorPaths(args, memoryFile, memorySizeBytes, mapping);
  const pathRefusal = portableProofPathRefusal(bundle.rootDir!, proofInputPaths(context));
  return pathRefusal ? refusedPlan(plan, pathRefusal.code, pathRefusal.message) : context;
}

function combinedDescriptorPaths(
  args: Args,
  memoryFile: string,
  memorySizeBytes: number,
  mapping: NativeMemoryMapping,
): CombinedDescriptorContext {
  const targetCodeFile = resolve(args.targetCodeFile!);
  const targetDir = dirname(targetCodeFile);
  return {
    targetDir,
    targetCodeFile,
    descriptorFile: join(targetDir, "combined-target-restore.desc"),
    memoryFile,
    fdFile: join(targetDir, "combined-fd-resource.txt"),
    memorySizeBytes,
    mapping,
  };
}

function proofInputPaths(context: CombinedDescriptorContext): Record<string, string> {
  return {
    "target-code": context.targetCodeFile,
    "target-descriptor": context.descriptorFile,
    "target-fd-resource": context.fdFile,
    "target-memory": context.memoryFile,
  };
}

function continuationDescriptor(
  targetCodeFile: string,
  argument0: string | undefined,
  stateReportAddress: string | undefined,
  translatedReturnAddress: string | undefined,
) {
  return {
    codeFile: GUEST_CODE,
    fileOffset: 0,
    codeSize: statSync(targetCodeFile).size,
    targetAddress: "0x700300000000",
    argument0,
    stateReportAddress,
    translatedReturnAddress,
    timeoutSeconds: 5,
    stackTargetStart: "0x500000000000",
    stackSize: 65_536,
    stackPointer: "0x500000010000",
  };
}

function proofMemoryPlan(context: CombinedDescriptorContext) {
  return planTargetGuestMemoryMaterialization({
    mappings: [context.mapping],
    memorySizeBytes: context.memorySizeBytes,
    memoryFile: GUEST_MEMORY,
  });
}

function proofFdTable() {
  return planNativeTargetFdTable({
    resources: proofFdResources(),
    expectedFds: [PROOF_CLOSED_FD],
    inheritedStdio: { mode: "inherit-output" },
    syntheticEmptyPipeFds: [PROOF_PIPE_READ_FD],
    syntheticEmptyEventFds: [PROOF_EVENT_FD],
    syntheticTimerFds: [PROOF_TIMER_FD],
  });
}

function targetInvocation(
  context: CombinedDescriptorContext,
  descriptorPlan: Extract<
    ReturnType<typeof planPortableMachineTargetRestoreDescriptor>,
    { state: "ready" }
  >,
  targetContinuation: PreparedTargetContinuation,
): TargetInvocation {
  return {
    descriptorFile: context.descriptorFile,
    memoryFile: context.memoryFile,
    fdFile: context.fdFile,
    descriptorMemoryEntryCount: descriptorPlan.memoryEntryCount,
    descriptorFdRecipeCount: descriptorPlan.fdRecipeCount,
    descriptorResourceKinds: descriptorPlan.descriptor.resources.map((resource) => resource.kind),
    expectedReturnValue: targetContinuation.expectedReturnValue,
    targetContinuationKind: targetContinuation.kind,
    targetModuleBytesSource: targetContinuation.targetModuleBytesSource,
    targetTranslatedReturnAddress: targetContinuation.translatedReturnAddress,
  };
}

function prepareTargetContinuation(
  args: Args,
  targetDir: string,
  memoryFile: string,
  mapping: NativeMemoryMapping,
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
): PreparedTargetContinuation | ReturnType<typeof planPortableMachineVmRestoreProof> {
  const expectedMemoryByte = firstByte(memoryFile, mapping);
  return args.realUtilityContinuation
    ? prepareRealUtilityContinuation(targetDir, expectedMemoryByte, plan)
    : {
        kind: "generated-verifier",
        bytes: combinedProofTargetCode(expectedMemoryByte),
      };
}

function prepareRealUtilityContinuation(
  targetDir: string,
  expectedMemoryByte: number,
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
) {
  const targetRoot = join(targetDir, "real-utility-root");
  const modulePath = join(targetRoot, "usr/bin/realspin-code");
  mkdirSync(dirname(modulePath), { recursive: true });
  const targetCode = stateConsumingRealUtilityTargetCode(expectedMemoryByte);
  const moduleBytes = targetCode.bytes;
  writeFileSync(modulePath, moduleBytes);
  const module = realUtilityTargetModule(sha256(moduleBytes), moduleBytes.length);
  const materialized = materializeNativeTargetModuleBytes({
    module,
    targetRoot,
    relativeStart: "0x0",
    sizeBytes: moduleBytes.length,
  });
  const refusal = materialized.refusals[0] ?? realUtilityPlanRefusal();
  if (refusal) {
    return refusedPlan(plan, refusal.code, refusal.message);
  }
  return {
    kind: "real-utility" as const,
    bytes: Buffer.from(materialized.materialized!.bytes),
    argument0: PROOF_MEMORY_TARGET,
    stateReportAddress: PROOF_MEMORY_TARGET,
    translatedReturnAddress: targetCode.translatedReturnAddress,
    expectedReturnValue: hex(FINAL_JUMP_EXPECTED_RETURN),
    targetModuleBytesSource: "portable-bundle-target-root",
  };
}

function realUtilityPlanRefusal() {
  const sourceFrame = realUtilitySourceFrame();
  const targetUnwind = matchNativeTargetUnwindFrame({
    sourceFrame,
    targetAddress: "0x700300000000",
    targetRules: [realUtilityTargetUnwindRule()],
  });
  const plan = planNativeRealUtilityContinuationAttempt({
    codeLocations: [realUtilityCodeLocation()],
    sourceFrames: [sourceFrame],
    targetUnwind,
  });
  return plan.blockingRefusal;
}

function realUtilityTargetModule(
  buildId: string,
  sizeBytes: number,
): NativeRealUtilityTargetModule {
  return {
    id: "target:realspin-code",
    logicalName: "realspin-code",
    path: "/usr/bin/realspin-code",
    arch: "amd64",
    kind: "pie-executable",
    buildId,
    loadBias: "0x700300000000",
    textMapping: "target:mapping:realspin-code",
    executable: true,
    executableRanges: [{ relativeStart: "0x0", relativeEnd: hex(BigInt(sizeBytes)) }],
  };
}

function realUtilitySourceFrame() {
  return {
    id: "frame:thread:realspin_loop",
    functionName: "realspin_loop",
    sourcePc: "0x401234",
    sourceSp: "0x700000000f00",
    cfa: "0x700000000f40",
    returnAddress: "0x401274",
    returnAddressSlot: "0x700000000f38",
    metadata: "eh-frame" as const,
    stackFrame: {
      id: "frame:thread:realspin_loop",
      sourceSp: "0x700000000f00",
      sourceReturnAddress: "0x401274",
      sizeBytes: 64,
      metadata: "dwarf" as const,
      locals: [],
    },
  };
}

function realUtilityTargetUnwindRule() {
  return {
    id: "target:realspin-final-jump",
    functionName: "realspin_loop",
    mapping: "target:mapping:realspin-code",
    pcStart: "0x700300000000",
    pcEnd: "0x700300000100",
    metadata: "eh-frame" as const,
    cfa: { register: "rsp" as const, offset: 8 },
    returnAddress: { location: "cfa-relative" as const, offset: -8 },
    calleeSaved: [],
  };
}

function realUtilityCodeLocation() {
  return {
    id: "code:thread:pc",
    sourceMapping: "mapping:source-text",
    sourceAddress: "0x401234",
    targetAddress: "0x700300000000",
    state: "mapped" as const,
  };
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const hex = (value: bigint): string => `0x${value.toString(16)}`;

function portableProofPathRefusal(
  bundleRoot: string,
  paths: Record<string, string>,
): { code: string; message: string } | undefined {
  const outside = Object.entries(paths).find(([, path]) => !inside(bundleRoot, path));
  if (!outside) {
    return undefined;
  }
  const [label, path] = outside;
  return {
    code: `${label}-outside-portable-bundle`,
    message: `${label} input must stay inside the portable machine bundle: ${path}`,
  };
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function selectProofMemoryMapping(
  mappings: NativeMemoryMapping[],
  memorySizeBytes: number,
): NativeMemoryMapping | undefined {
  const candidate = mappings.find((mapping) => {
    const captured = mapping.captured;
    return [
      mapping.permissions.write,
      !mapping.permissions.execute,
      mapping.target.materialization === "translate",
      captured !== undefined,
      captured ? captured.offset + PROOF_MEMORY_SIZE <= memorySizeBytes : false,
      captured ? captured.sizeBytes >= PROOF_MEMORY_SIZE : false,
    ].every(Boolean);
  });
  if (!candidate?.captured) {
    return undefined;
  }
  return {
    ...candidate,
    id: `${candidate.id}:combined-proof-page`,
    sizeBytes: PROOF_MEMORY_SIZE,
    captured: {
      file: NATIVE_PROCESS_IMAGE_FILES.memory,
      offset: candidate.captured.offset,
      sizeBytes: PROOF_MEMORY_SIZE,
    },
    target: {
      materialization: "translate",
      targetStart: PROOF_MEMORY_TARGET,
      reason: "combined target VM proof materializes one safe captured page",
    },
  };
}

function proofFdResources(): NativeProcessResource[] {
  return [
    proofStdoutResource(),
    proofFileResource(),
    proofPipeResource(PROOF_PIPE_READ_FD, "read"),
    proofPipeResource(PROOF_PIPE_WRITE_FD, "write"),
    proofSyntheticResource("eventfd", PROOF_EVENT_FD),
    proofSyntheticResource("timer", PROOF_TIMER_FD),
  ];
}

function proofStdoutResource(): NativeProcessResource {
  return {
    id: `fd:${PROOF_STDOUT_FD}:combined-proof-stdout`,
    kind: "fd",
    state: "captured",
    fd: PROOF_STDOUT_FD,
    flags: ["octal:1"],
  };
}

function proofFileResource(): NativeProcessResource {
  return {
    id: `fd:${PROOF_FILE_FD}:combined-proof-file`,
    kind: "file",
    state: "recipe",
    fd: PROOF_FILE_FD,
    path: GUEST_FD_FILE,
    offset: 0,
    flags: ["octal:0"],
    recipe: { reopen: GUEST_FD_FILE, offset: 0 },
  };
}

function proofPipeResource(fd: number, end: "read" | "write"): NativeProcessResource {
  return {
    id: `fd:${fd}:combined-proof-pipe-${end}`,
    kind: "pipe",
    state: "captured",
    fd,
    path: "pipe:combined-proof",
    flags: [end === "read" ? "octal:0" : "octal:1"],
  };
}

function proofSyntheticResource(kind: "eventfd" | "timer", fd: number): NativeProcessResource {
  return {
    id: `fd:${fd}:combined-proof-${kind}`,
    kind,
    state: "captured",
    fd,
    flags: ["octal:0"],
  };
}

function firstByte(memoryFile: string, mapping: NativeMemoryMapping): number {
  const bytes = readFileSync(memoryFile);
  return bytes[mapping.captured!.offset] ?? 0;
}

function combinedProofTargetCode(expectedMemoryByte: number): Buffer {
  return proofStateVerifierTargetCode(expectedMemoryByte, "exit").bytes;
}

function stateConsumingRealUtilityTargetCode(expectedMemoryByte: number): {
  bytes: Buffer;
  translatedReturnAddress: string;
} {
  const code = proofStateVerifierTargetCode(expectedMemoryByte, "return");
  return {
    bytes: code.bytes,
    translatedReturnAddress: hex(0x700300000000n + BigInt(code.translatedReturnOffset)),
  };
}

type ProofCompletionMode = "exit" | "return";

function proofStateVerifierTargetCode(
  expectedMemoryByte: number,
  completion: ProofCompletionMode,
): { bytes: Buffer; translatedReturnOffset: number } {
  const asm = new Amd64ProofAssembler();
  if (completion === "return") {
    asm.preserveRbx();
    asm.movRbxFromRdi();
    asm.storeReportWord(16, 0n);
  } else {
    asm.movRbxImmediate(BigInt(PROOF_MEMORY_TARGET));
  }
  asm.checkMemoryByte(expectedMemoryByte);
  asm.markStateCheck(completion, STATE_CHECK_MEMORY);
  asm.checkFdClosed(PROOF_CLOSED_FD);
  asm.markStateCheck(completion, STATE_CHECK_CLOSE_FD);
  asm.checkFdOpen(PROOF_STDOUT_FD);
  asm.markStateCheck(completion, STATE_CHECK_STDIO);
  asm.readAndCheck(PROOF_FILE_FD, PROOF_FD_BYTES);
  asm.markStateCheck(completion, STATE_CHECK_REOPEN_FILE);
  asm.checkFdOpen(PROOF_PIPE_READ_FD);
  asm.checkFdOpen(PROOF_PIPE_WRITE_FD);
  asm.markStateCheck(completion, STATE_CHECK_PIPE);
  asm.checkFdOpen(PROOF_EVENT_FD);
  asm.markStateCheck(completion, STATE_CHECK_EVENTFD);
  asm.checkFdOpen(PROOF_TIMER_FD);
  asm.markStateCheck(completion, STATE_CHECK_TIMERFD);
  asm.completeSuccessfully(completion);
  return asm.toTargetCode(completion);
}

class Amd64ProofAssembler {
  private readonly bytes: number[] = [];
  private readonly jumps: number[] = [];

  preserveRbx(): void {
    this.push(0x53);
  }

  movRbxFromRdi(): void {
    this.push(0x48, 0x89, 0xfb);
  }

  movRbxImmediate(value: bigint): void {
    this.push(0x48, 0xbb);
    this.pushU64(value);
  }

  checkMemoryByte(expected: number): void {
    this.push(0x80, 0x3b, expected);
    this.jumpIfNotEqual();
  }

  checkFdOpen(fd: number): void {
    this.fcntlGetFd(fd);
    this.push(0x48, 0x85, 0xc0);
    this.jumpIfSign();
  }

  checkFdClosed(fd: number): void {
    this.fcntlGetFd(fd);
    this.push(0x83, 0xf8, 0xf7);
    this.jumpIfNotEqual();
  }

  readAndCheck(fd: number, expected: Buffer): void {
    this.push(0x31, 0xc0);
    this.movFd(fd);
    this.push(0x48, 0x8d, 0x73, 0x40, 0xba);
    this.pushU32(expected.length);
    this.push(0x0f, 0x05, 0x83, 0xf8, expected.length);
    this.jumpIfNotEqual();
    for (const [index, byte] of expected.entries()) {
      this.push(0x80, 0x7b, 0x40 + index, byte);
      this.jumpIfNotEqual();
    }
  }

  markStateCheck(completion: ProofCompletionMode, bit: number): void {
    if (completion === "return") {
      this.push(0x48, 0x83, 0x4b, 0x10, bit);
    }
  }

  completeSuccessfully(completion: ProofCompletionMode): void {
    if (completion === "return") {
      this.storeReportWord(8, STATE_CONSUMPTION_MARKER);
      this.push(0x48, 0x89, 0xdf, 0xb8);
      this.pushU32(Number(FINAL_JUMP_EXPECTED_RETURN));
      this.push(0x5b, 0xc3);
      return;
    }
    this.syscall(60);
    this.push(0x31, 0xff, 0x0f, 0x05);
  }

  storeReportWord(offset: number, value: bigint): void {
    this.push(0x48, 0xb8);
    this.pushU64(value);
    this.push(0x48, 0x89, 0x43, offset);
  }

  toTargetCode(completion: ProofCompletionMode): { bytes: Buffer; translatedReturnOffset: number } {
    const translatedReturnOffset = this.appendTranslatedReturnLanding(completion);
    const failOffset = this.bytes.length;
    this.completeWithFailure(completion);
    this.patchJumps(failOffset);
    return { bytes: Buffer.from(this.bytes), translatedReturnOffset };
  }

  private fcntlGetFd(fd: number): void {
    this.syscall(72);
    this.movFd(fd);
    this.push(0xbe);
    this.pushU32(1);
    this.push(0x31, 0xd2, 0x0f, 0x05);
  }

  private appendTranslatedReturnLanding(completion: ProofCompletionMode): number {
    const offset = this.bytes.length;
    if (completion === "return") {
      this.push(0x48, 0xba);
      this.pushU64(FINAL_JUMP_RETURN_MARKER);
      this.push(0x48, 0x89, 0x57, 0x18, 0xb8);
      this.pushU32(Number(FINAL_JUMP_EXPECTED_RETURN));
      this.push(0xc3);
    }
    return offset;
  }

  private completeWithFailure(completion: ProofCompletionMode): void {
    if (completion === "return") {
      this.push(0xb8);
      this.pushU32(42);
      this.push(0x5b, 0x48, 0x83, 0xc4, 0x08, 0xc3);
      return;
    }
    this.syscall(60);
    this.movFd(42);
    this.push(0x0f, 0x05);
  }

  private syscall(number: number): void {
    this.push(0xb8);
    this.pushU32(number);
  }

  private movFd(fd: number): void {
    this.push(0xbf);
    this.pushU32(fd);
  }

  private jumpIfNotEqual(): void {
    this.jumpToFail(0x85);
  }

  private jumpIfSign(): void {
    this.jumpToFail(0x88);
  }

  private jumpToFail(condition: number): void {
    this.push(0x0f, condition, 0x00, 0x00, 0x00, 0x00);
    this.jumps.push(this.bytes.length - 4);
  }

  private patchJumps(failOffset: number): void {
    for (const index of this.jumps) {
      const relative = failOffset - (index + 4);
      this.bytes[index] = relative & 0xff;
      this.bytes[index + 1] = (relative >> 8) & 0xff;
      this.bytes[index + 2] = (relative >> 16) & 0xff;
      this.bytes[index + 3] = (relative >> 24) & 0xff;
    }
  }

  private push(...values: number[]): void {
    this.bytes.push(...values.map((value) => value & 0xff));
  }

  private pushU32(value: number): void {
    this.push(value, value >> 8, value >> 16, value >> 24);
  }

  private pushU64(value: bigint): void {
    for (let i = 0n; i < 8n; i++) {
      this.push(Number((value >> (8n * i)) & 0xffn));
    }
  }
}

function refusedPlan(
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
  code: string,
  message: string,
): ReturnType<typeof planPortableMachineVmRestoreProof> {
  return { ...plan, state: "refused", migrationCompleted: false, refusal: { code, message } };
}

function runTargetProof(
  args: Args,
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
  invocation: TargetInvocation = {},
) {
  const target = spawnSync(process.execPath, targetCommand(args, invocation), targetSpawnOptions());
  return target.status === 0
    ? completePortableMachineVmRestoreProof(plan, JSON.parse(target.stdout))
    : {
        ...plan,
        state: "refused" as const,
        refusal: { code: "target-vm-proof-failed", message: target.stderr || target.stdout },
      };
}

function targetCommand(args: Args, invocation: TargetInvocation): string[] {
  return [
    "--import",
    "tsx",
    "scripts/native-target-vm-synthetic-continuation.ts",
    "verify",
    ...targetArgs(args, invocation),
  ];
}

function targetSpawnOptions() {
  return {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8" as const,
    maxBuffer: 20 * 1024 * 1024,
  };
}

function targetVmSkipReason(image: string | undefined): string | undefined {
  return hostSkipReason() ?? imageSkipReason(image);
}

function hostSkipReason(): string | undefined {
  return process.platform === "linux" && process.arch === "x64"
    ? undefined
    : "target VM proof requires Linux/amd64 host";
}

function imageSkipReason(image: string | undefined): string | undefined {
  return image && existsSync(image)
    ? undefined
    : "--image or MACHINEN_TARGET_VM_IMAGE must point at a target rootfs";
}

function targetArgs(args: Args, invocation: TargetInvocation): string[] {
  return [
    "--code-file",
    args.targetCodeFile!,
    "--image",
    args.image!,
    "--json",
    ...combinedInvocationArgs(invocation),
    ...resourceArgs(args),
  ];
}

function combinedInvocationArgs(invocation: TargetInvocation): string[] {
  return [
    ...optionalArg("--descriptor-file", invocation.descriptorFile),
    ...optionalArg("--memory-file", invocation.memoryFile),
    ...optionalArg("--guest-memory-file", invocation.memoryFile ? GUEST_MEMORY : undefined),
    ...optionalArg("--fd-file", invocation.fdFile),
    ...optionalArg("--guest-fd-file", invocation.fdFile ? GUEST_FD_FILE : undefined),
    ...optionalArg("--expect-return-value", invocation.expectedReturnValue),
  ];
}

function optionalArg(flag: string, value: string | undefined): string[] {
  return value ? [flag, value] : [];
}

function resourceArgs(args: Args): string[] {
  if (args.syntheticEmptyEventFd) {
    return ["--synthetic-empty-eventfd", args.syntheticEmptyEventFd];
  }
  if (args.syntheticTimerFd) {
    return ["--synthetic-timerfd", args.syntheticTimerFd];
  }
  if (!args.syntheticEmptyPipeReadFd) {
    return [];
  }
  return [
    "--synthetic-empty-pipe-read-fd",
    args.syntheticEmptyPipeReadFd,
    ...pipeWriteFdArg(args.syntheticEmptyPipeWriteFd),
  ];
}

function pipeWriteFdArg(writeFd: string | undefined): string[] {
  return writeFd ? ["--synthetic-empty-pipe-write-fd", writeFd] : [];
}

const args = parseArgs(process.argv.slice(2));
const summary = runProof(args);
if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(
    `portable-machine-vm-restore-proof: state=${summary.state} migrationCompleted=${summary.migrationCompleted}`,
  );
}
