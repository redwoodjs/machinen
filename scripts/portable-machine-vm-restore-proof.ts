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
  type NativeProcessImageDocuments,
  type NativeProcessResource,
} from "../packages/runtime/src/native-process-image.ts";
import { planNativeRealUtilityContinuationAttempt } from "../packages/runtime/src/native-real-utility-continuation.ts";
import { planNativeTargetFdTable } from "../packages/runtime/src/native-resource-translation.ts";
import type { NativeRealUtilityTargetModule } from "../packages/runtime/src/native-real-utility-code-map.ts";
import { materializeNativeTargetModuleBytes } from "../packages/runtime/src/native-target-module-bytes.ts";
import { matchNativeTargetUnwindFrame } from "../packages/runtime/src/native-target-unwind.ts";
import { planNativeThreadRestoreBoundary } from "../packages/runtime/src/native-thread-restore-policy.ts";
import { planNativeControlledTwoThreadRestoreBoundary } from "../packages/runtime/src/native-two-thread-boundary.ts";
import { validatePortableMachineSnapshotBundle } from "../packages/runtime/src/portable-machine-snapshot.ts";
import { planTargetGuestActiveSyscallRestore } from "../packages/runtime/src/target-guest-active-syscall-restore.ts";
import { planTargetGuestMemoryMaterialization } from "../packages/runtime/src/target-guest-memory-materialization.ts";
import { planTargetGuestPrivateMemoryRestore } from "../packages/runtime/src/target-guest-private-memory-restore.ts";
import { planTargetGuestProcessContextRestore } from "../packages/runtime/src/target-guest-process-context-restore.ts";
import {
  serializeTargetGuestRestoreDescriptor,
  type TargetGuestNativeRestoreStep,
  type TargetGuestTranslatedFrameDescriptor,
} from "../packages/runtime/src/target-guest-restore-loader.ts";
import {
  planTargetGuestTwoThreadRestore,
  type TargetGuestTwoThreadSpawnStep,
} from "../packages/runtime/src/target-guest-two-thread-restore.ts";
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
  processContextRestore?:
    | "metadata-only"
    | "apply-target-env-cwd"
    | "apply-target-visible-context"
    | "apply-target-initial-stack";
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
  targetTranslatedFramePointer?: string;
  targetRegisterRestoreResult?: "pending";
  targetRflagsRestoreResult?: "pending";
  targetTlsRestoreResult?: "pending";
  targetStackWindowMaterializationResult?: "pending";
  targetPrivateMemoryRestoreResult?: "pending";
  targetExecutableMappingResult?: "pending";
  targetProcessContextRestoreResult?: "pending";
  targetSignalRestoreResult?: "pending";
  targetActiveSyscallRestoreResult?: "pending";
  targetThreadRestoreResult?: "accepted";
  targetThreadRestoreThreadId?: string;
  targetResumePathResult?: "pending";
  targetResumePathMode?: "translated-frame";
}

interface CombinedDescriptorPaths {
  targetDir: string;
  targetCodeFile: string;
  descriptorFile: string;
  memoryFile: string;
  fdFile: string;
  memorySizeBytes: number;
  mapping: NativeMemoryMapping;
}

interface CombinedDescriptorContext extends CombinedDescriptorPaths {
  targetThreadRestoreResult: "accepted";
  targetThreadRestoreThreadId: string;
  targetSignalBlockedMasks: string[];
  targetActiveSyscallSteps: Extract<
    ReturnType<typeof planTargetGuestActiveSyscallRestore>,
    { state: "planned" }
  >["steps"];
  targetThreadSpawnSteps: TargetGuestTwoThreadSpawnStep[];
  targetProcessContextSteps: TargetGuestNativeRestoreStep[];
  activeFileReadProof?: ActiveFileReadProof;
  activeFileWriteProof?: ActiveFileWriteProof;
}

interface ActiveFileReadProof {
  fd: number;
  fileOffset: number;
  targetBufferPointer: string;
  expectedBytes: Buffer;
}

interface ActiveFileWriteProof {
  fd: number;
  fileOffset: number;
  targetBufferPointer: string;
  expectedBytes: Buffer;
}

interface PreparedTargetContinuation {
  kind: "generated-verifier" | "real-utility";
  bytes: Buffer;
  argument0?: string;
  stateReportAddress?: string;
  targetFsBase?: string;
  translatedReturnAddress?: string;
  translatedFrame?: TargetGuestTranslatedFrameDescriptor;
  expectedReturnValue?: string;
  targetModuleBytesSource?: string;
}

type AcceptedThreadPlan = Extract<
  ReturnType<typeof planNativeThreadRestoreBoundary>,
  { state: "accepted" }
>;
type ActiveSyscallContinuations = AcceptedThreadPlan["activeSyscallContinuations"];

type ProofThreadContext =
  | {
      state: "accepted";
      threadId: string;
      signalBlockedMasks: string[];
      activeSyscallContinuations: ActiveSyscallContinuations;
      threadSpawnSteps: TargetGuestTwoThreadSpawnStep[];
      refusals: [];
    }
  | { state: "refused"; refusals: Array<{ code: string; message: string }> };

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
const PROOF_FILE_READ_BYTES = Buffer.from("FILE");
const PROOF_FILE_WRITE_BYTES = Buffer.from("WRIT");
const PROOF_INITIAL_STACK_TARGET = "0x600000002000";
const STATE_CONSUMPTION_MARKER = 0x5354415445434f4en;
const STATE_CHECK_MEMORY = 0x01;
const STATE_CHECK_STDIO = 0x02;
const STATE_CHECK_CLOSE_FD = 0x04;
const STATE_CHECK_REOPEN_FILE = 0x08;
const STATE_CHECK_PIPE = 0x10;
const STATE_CHECK_EVENTFD = 0x20;
const STATE_CHECK_TIMERFD = 0x40;
const TRANSLATED_FRAME_MARKER = 0x4652414d45504153n;
const TRANSLATED_RESUME_MARKER = 0x524553554d455041n;
const TRANSLATED_FRAME_POINTER = "0x50000000ff80";
const TRANSLATED_FRAME_CFA = "0x50000000fff0";
const TRANSLATED_FRAME_RETURN_ADDRESS_SLOT = "0x50000000fff0";
const TRANSLATED_FRAME_SLOT_OFFSET = 0;
const TRANSLATED_FRAME_SECOND_SLOT_OFFSET = 8;
const TRANSLATED_FRAME_SECOND_SLOT_MARKER = 0x535441434b534c54n;
const TRANSLATED_FRAME_RBX = "0x1111111122222222";
const TRANSLATED_FRAME_R12 = "0x1234567890abcdef";
const TRANSLATED_FRAME_R13 = "0x1313131313131313";
const TRANSLATED_FRAME_R14 = "0x1414141414141414";
const TRANSLATED_FRAME_R15 = "0x1515151515151515";
const TRANSLATED_FRAME_UNWIND_ID = "target:realspin-final-jump";
const TRANSLATED_FRAME_REGISTER_MASK_OFFSET = 48;
const TRANSLATED_FRAME_REGISTER_MASK_RBX = 0x01;
const TRANSLATED_FRAME_REGISTER_MASK_R12 = 0x02;
const TRANSLATED_FRAME_REGISTER_MASK_R13 = 0x04;
const TRANSLATED_FRAME_REGISTER_MASK_R14 = 0x08;
const TRANSLATED_FRAME_REGISTER_MASK_R15 = 0x10;
const RESUME_REGISTER_MARKER = 0x52454753544f5245n;
const RESUME_RFLAGS_MARKER = 0x52464c4147534f4bn;
const TLS_RESTORE_MARKER = 0x544c534f4b504153n;
const TLS_TCB_MARKER = 0x5443425041534f4bn;
const TARGET_TLS_BASE = "0x600000000300";
const TARGET_THREAD_STACK_BASES = ["0x530000000000", "0x530000020000"] as const;
const TARGET_THREAD_STACK_LIMITS = ["0x530000010000", "0x530000030000"] as const;
const RESUME_RFLAGS = "0x8d7";
const RESUME_REGISTER_RAX = "0x2121212121212121";
const RESUME_REGISTER_RDI = "0x7171717171717171";
const RESUME_REGISTER_RSI = "0x6161616161616161";
const RESUME_REGISTER_RDX = "0x6262626262626262";
const RESUME_REGISTER_RCX = "0x6363636363636363";
const RESUME_REGISTER_R8 = "0x8888888888888888";
const RESUME_REGISTER_R9 = "0x9999999999999999";
const RESUME_REGISTER_R10 = "0x1010101010101010";
const RESUME_REGISTER_R11 = "0x1111111111111111";

function usage(): never {
  console.error(
    "usage: tsx scripts/portable-machine-vm-restore-proof.ts verify " +
      "--bundle-dir path --target-code-file path [--image rootfs.tar.gz] " +
      "[--combined-descriptor] [--real-utility-continuation] " +
      "[--process-context-restore metadata-only|apply-target-env-cwd|apply-target-visible-context|apply-target-initial-stack] [--json]",
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
    processContextRestore: parseProcessContextRestoreMode(read("--process-context-restore")),
  };
}

const PROCESS_CONTEXT_RESTORE_MODES = [
  "metadata-only",
  "apply-target-env-cwd",
  "apply-target-visible-context",
  "apply-target-initial-stack",
] as const;

function parseProcessContextRestoreMode(value: string | undefined): Args["processContextRestore"] {
  if (value === undefined) {
    return undefined;
  }
  return PROCESS_CONTEXT_RESTORE_MODES.includes(
    value as (typeof PROCESS_CONTEXT_RESTORE_MODES)[number],
  )
    ? (value as Args["processContextRestore"])
    : usage();
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
  if (!invocation) {
    return plan;
  }
  return {
    ...plan,
    ...descriptorSummary(invocation),
    ...realUtilityPendingResults(invocation),
    targetVerifierResult: "pending",
  };
}

function descriptorSummary(invocation: TargetInvocation) {
  return {
    descriptorMemoryEntryCount: invocation.descriptorMemoryEntryCount,
    descriptorFdRecipeCount: invocation.descriptorFdRecipeCount,
    descriptorResourceKinds: invocation.descriptorResourceKinds,
    targetContinuationKind: invocation.targetContinuationKind,
    targetModuleBytesSource: invocation.targetModuleBytesSource,
    targetTranslatedReturnAddress: invocation.targetTranslatedReturnAddress,
    targetTranslatedFramePointer: invocation.targetTranslatedFramePointer,
    targetRegisterRestoreResult: invocation.targetRegisterRestoreResult,
    targetStackWindowMaterializationResult: invocation.targetStackWindowMaterializationResult,
    targetPrivateMemoryRestoreResult: invocation.targetPrivateMemoryRestoreResult,
    targetExecutableMappingResult: invocation.targetExecutableMappingResult,
    targetProcessContextRestoreResult: invocation.targetProcessContextRestoreResult,
    targetSignalRestoreResult: invocation.targetSignalRestoreResult,
    targetActiveSyscallRestoreResult: invocation.targetActiveSyscallRestoreResult,
    targetThreadRestoreResult: invocation.targetThreadRestoreResult,
    targetThreadRestoreThreadId: invocation.targetThreadRestoreThreadId,
    targetResumePathResult: invocation.targetResumePathResult,
    targetResumePathMode: invocation.targetResumePathMode,
  };
}

function realUtilityPendingResults(invocation: TargetInvocation) {
  return invocation.targetContinuationKind === "real-utility"
    ? {
        targetStateConsumptionResult: "pending" as const,
        targetReturnChainResult: "pending" as const,
        targetFrameRestoreResult: "pending" as const,
        targetRegisterRestoreResult: "pending" as const,
        targetStackWindowMaterializationResult: invocation.targetStackWindowMaterializationResult,
        targetPrivateMemoryRestoreResult: invocation.targetPrivateMemoryRestoreResult,
        targetExecutableMappingResult: invocation.targetExecutableMappingResult,
        targetProcessContextRestoreResult: invocation.targetProcessContextRestoreResult,
        targetSignalRestoreResult: invocation.targetSignalRestoreResult,
        targetActiveSyscallRestoreResult: invocation.targetActiveSyscallRestoreResult,
        targetResumePathResult: "pending" as const,
      }
    : {};
}

function prepareCombinedDescriptor(
  args: Args,
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
): TargetInvocation | ReturnType<typeof planPortableMachineVmRestoreProof> {
  const context = combinedDescriptorContext(args, plan);
  if (isRestorePlan(context)) {
    return context;
  }
  writeFileSync(context.fdFile, proofFdFileBytes(context));
  const targetContinuation = prepareTargetContinuation(
    args,
    context.targetDir,
    context.memoryFile,
    context.mapping,
    context.activeFileReadProof,
    proofFdVerifierBytes(context),
    plan,
  );
  if (isRestorePlan(targetContinuation)) {
    return targetContinuation;
  }
  writeFileSync(context.targetCodeFile, targetContinuation.bytes);

  const descriptorPlan = prepareTargetRestoreDescriptor(context, targetContinuation);
  if (descriptorPlan.state === "refused") {
    const first = descriptorPlan.refusals[0]!;
    return refusedPlan(plan, first.code, first.message);
  }
  writeTargetRestoreDescriptor(context, descriptorPlan.descriptor);
  return targetInvocation(context, descriptorPlan, targetContinuation);
}

function prepareTargetRestoreDescriptor(
  context: CombinedDescriptorContext,
  targetContinuation: PreparedTargetContinuation,
) {
  const memory = proofMemoryPlan(context);
  const nativeRestore = proofNativeRestoreSections(context, targetContinuation, memory.entries);
  return planPortableMachineTargetRestoreDescriptor({
    continuation: continuationDescriptor(
      context.targetCodeFile,
      targetContinuation.argument0,
      targetContinuation.stateReportAddress,
      targetContinuation.targetFsBase,
      targetContinuation.translatedReturnAddress,
      targetContinuation.translatedFrame ? "translated-frame" : undefined,
      targetContinuation.translatedFrame ? RESUME_RFLAGS : undefined,
      targetContinuation.translatedFrame ? proofResumeRegisters() : undefined,
    ),
    translatedFrame: targetContinuation.translatedFrame,
    fdTable: proofFdTable(context),
    memory: descriptorMemoryForNativeRestore(memory, nativeRestore),
    nativeRestore,
  });
}

function descriptorMemoryForNativeRestore(
  memory: ReturnType<typeof proofMemoryPlan>,
  nativeRestore: TargetGuestNativeRestoreStep[],
): ReturnType<typeof proofMemoryPlan> {
  return nativeRestore.some((step) => step.section === "private-memory")
    ? { entries: [], refusals: memory.refusals }
    : memory;
}

function writeTargetRestoreDescriptor(
  context: CombinedDescriptorContext,
  descriptor: Extract<
    ReturnType<typeof planPortableMachineTargetRestoreDescriptor>,
    { state: "ready" }
  >["descriptor"],
): void {
  writeFileSync(context.descriptorFile, serializeTargetGuestRestoreDescriptor(descriptor));
}

// fallow-ignore-next-line complexity
function combinedDescriptorContext(
  args: Args,
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
): CombinedDescriptorContext | ReturnType<typeof planPortableMachineVmRestoreProof> {
  const bundle = validatePortableMachineSnapshotBundle(args.bundleDir!);
  const memory = proofMemorySelection(bundle);
  if (!memory.mapping) {
    return refusedPlan(
      plan,
      "mapping-ambiguous",
      "portable machine proof needs one safe captured writable memory page",
    );
  }
  const threads = proofThreadContext(bundle, memory.mapping);
  if (threads.state === "refused") {
    return firstRefusedPlan(plan, threads.refusals);
  }
  const activeSyscallPlan = proofActiveSyscallPlan(threads.activeSyscallContinuations);
  if (activeSyscallPlan.state === "refused") {
    return firstRefusedPlan(plan, activeSyscallPlan.refusals);
  }
  const processContextSteps = proofProcessContextNativeSections(bundle, args.processContextRestore);
  if (processContextSteps.state === "refused") {
    return firstRefusedPlan(plan, processContextSteps.refusals);
  }
  const context = {
    ...combinedDescriptorPaths(args, memory.file, memory.sizeBytes, memory.mapping),
    targetThreadRestoreResult: threads.state,
    targetThreadRestoreThreadId: threads.threadId,
    targetSignalBlockedMasks: threads.signalBlockedMasks,
    targetActiveSyscallSteps: activeSyscallPlan.steps,
    targetThreadSpawnSteps: threads.threadSpawnSteps,
    targetProcessContextSteps: processContextSteps.steps,
    activeFileReadProof: activeFileReadProof(activeSyscallPlan.steps),
    activeFileWriteProof: activeFileWriteProof(activeSyscallPlan.steps),
  };
  return contextAfterPathCheck(plan, bundle.rootDir!, context);
}

function proofProcessContextNativeSections(
  bundle: ReturnType<typeof validatePortableMachineSnapshotBundle>,
  mode: Args["processContextRestore"],
):
  | { state: "planned"; steps: TargetGuestNativeRestoreStep[] }
  | { state: "refused"; refusals: Array<{ code: string; message: string }> } {
  if (!mode) {
    return { state: "planned", steps: [] };
  }
  const plan = planTargetGuestProcessContextRestore(bundle.nativeProcessImage, {
    mode,
    initialStackTargetStart: PROOF_INITIAL_STACK_TARGET,
  });
  return plan.state === "planned"
    ? {
        state: "planned",
        steps: plan.steps.map((step) => ({ section: "process-context" as const, step })),
      }
    : { state: "refused", refusals: plan.refusals };
}

function contextAfterPathCheck(
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
  rootDir: string,
  context: CombinedDescriptorContext,
): CombinedDescriptorContext | ReturnType<typeof planPortableMachineVmRestoreProof> {
  const pathRefusal = portableProofPathRefusal(rootDir, proofInputPaths(context));
  return pathRefusal ? refusedPlan(plan, pathRefusal.code, pathRefusal.message) : context;
}

function proofThreadContext(
  bundle: ReturnType<typeof validatePortableMachineSnapshotBundle>,
  mapping: NativeMemoryMapping,
): ProofThreadContext {
  const documents = bundleWithProofMemoryMapping(bundle, mapping);
  const threads = documents.threads.threads;
  if (threads.length === 2) {
    return proofTwoThreadContext(bundle, documents);
  }
  const plan = planNativeThreadRestoreBoundary({
    threads,
    mappings: documents.mappings.mappings,
    resources: documents.resources.resources,
    tls: { targetFsBase: TARGET_TLS_BASE, targetAccessPolicy: "target-tcb-materialized" },
    activeSyscall: activeSyscallPolicy(bundle, documents),
  });
  return plan.state === "accepted"
    ? {
        state: "accepted",
        threadId: plan.threadId,
        signalBlockedMasks: plan.signalRestore.blockedMasks,
        activeSyscallContinuations: plan.activeSyscallContinuations,
        threadSpawnSteps: [],
        refusals: [],
      }
    : plan;
}

function proofTwoThreadContext(
  bundle: ReturnType<typeof validatePortableMachineSnapshotBundle>,
  documents = bundle.nativeProcessImage,
): ProofThreadContext {
  const boundary = planNativeControlledTwoThreadRestoreBoundary({
    threads: documents.threads.threads,
    mappings: documents.mappings.mappings,
    resources: documents.resources.resources,
    activeSyscall: activeSyscallPolicy(bundle, documents),
  });
  if (boundary.state === "refused") {
    return boundary;
  }
  const spawnPlan = planTargetGuestTwoThreadRestore(
    boundary,
    proofTwoThreadBindings(boundary.threadIds),
  );
  if (spawnPlan.state === "refused") {
    return spawnPlan;
  }
  return {
    state: "accepted",
    threadId: boundary.threadIds.join(","),
    signalBlockedMasks: boundary.threadPlans[0].signalRestore.blockedMasks,
    activeSyscallContinuations: boundary.threadPlans.flatMap(
      (threadPlan) => threadPlan.activeSyscallContinuations,
    ),
    threadSpawnSteps: spawnPlan.steps,
    refusals: [],
  };
}

function activeSyscallPolicy(
  bundle: ReturnType<typeof validatePortableMachineSnapshotBundle>,
  documents = bundle.nativeProcessImage,
) {
  return {
    sleepTimerPolicy: "defer-target-resume" as const,
    pollTimeoutPolicy: "defer-target-resume" as const,
    pollTimeoutFdPolicy: "synthetic-timerfd" as const,
    fdReadPolicy: "defer-target-resume" as const,
    fdReadResourcePolicy: fdReadResourcePolicy(bundle),
    fdWritePolicy: "defer-target-resume" as const,
    fdWriteResourcePolicy: "reopen-file" as const,
    documents,
  };
}

function bundleWithProofMemoryMapping(
  bundle: ReturnType<typeof validatePortableMachineSnapshotBundle>,
  mapping: NativeMemoryMapping,
): NativeProcessImageDocuments {
  return {
    ...bundle.nativeProcessImage,
    mappings: {
      ...bundle.nativeProcessImage.mappings,
      mappings: bundle.nativeProcessImage.mappings.mappings.map((candidate) =>
        candidate.id === mapping.id ||
        candidate.id === mapping.id.replace(/:combined-proof-page$/, "")
          ? mapping
          : candidate,
      ),
    },
  };
}

function fdReadResourcePolicy(
  bundle: ReturnType<typeof validatePortableMachineSnapshotBundle>,
): "synthetic-empty-pipe" | "synthetic-empty-eventfd" | "synthetic-timerfd" | "reopen-file" {
  return fdReadResourcePolicyForKind(activeReadResourceKind(bundle));
}

function activeReadResourceKind(
  bundle: ReturnType<typeof validatePortableMachineSnapshotBundle>,
): NativeProcessResource["kind"] | undefined {
  const thread = bundle.nativeProcessImage.threads.threads.find(isActiveReadThread);
  const fd = thread ? activeReadFd(thread) : undefined;
  return bundle.nativeProcessImage.resources.resources.find((resource) => resource.fd === fd)?.kind;
}

function fdReadResourcePolicyForKind(
  kind: NativeProcessResource["kind"] | undefined,
): "synthetic-empty-pipe" | "synthetic-empty-eventfd" | "synthetic-timerfd" | "reopen-file" {
  return kind === "eventfd"
    ? "synthetic-empty-eventfd"
    : kind === "timer"
      ? "synthetic-timerfd"
      : kind === "file"
        ? "reopen-file"
        : "synthetic-empty-pipe";
}

function isActiveReadThread(
  thread: ReturnType<
    typeof validatePortableMachineSnapshotBundle
  >["nativeProcessImage"]["threads"]["threads"][number],
): boolean {
  return thread.syscall.state === "inside-syscall" && thread.syscall.name === "read";
}

function isActiveWriteThread(
  thread: ReturnType<
    typeof validatePortableMachineSnapshotBundle
  >["nativeProcessImage"]["threads"]["threads"][number],
): boolean {
  return thread.syscall.state === "inside-syscall" && thread.syscall.name === "write";
}

function activeReadFd(
  thread: ReturnType<
    typeof validatePortableMachineSnapshotBundle
  >["nativeProcessImage"]["threads"]["threads"][number],
): number | undefined {
  const raw = thread.syscall.arguments?.[0] ?? activeReadRegisterFd(thread);
  return raw === undefined ? undefined : safeBigIntNumber(raw);
}

function activeReadRegisterFd(
  thread: ReturnType<
    typeof validatePortableMachineSnapshotBundle
  >["nativeProcessImage"]["threads"]["threads"][number],
): string | undefined {
  return thread.sourceRegisters.arch === "arm64" ? thread.sourceRegisters.x[0] : undefined;
}

// fallow-ignore-next-line complexity
function activeReadBufferPointer(
  bundle: ReturnType<typeof validatePortableMachineSnapshotBundle>,
): bigint | undefined {
  const thread = bundle.nativeProcessImage.threads.threads.find(isActiveReadThread);
  const raw = thread
    ? (thread.syscall.arguments?.[1] ?? activeReadRegisterBuffer(thread))
    : undefined;
  return raw === undefined ? undefined : safeBigInt(raw);
}

function activeReadRegisterBuffer(
  thread: ReturnType<
    typeof validatePortableMachineSnapshotBundle
  >["nativeProcessImage"]["threads"]["threads"][number],
): string | undefined {
  return thread.sourceRegisters.arch === "arm64" ? thread.sourceRegisters.x[1] : undefined;
}

// fallow-ignore-next-line complexity
function activeWriteBufferPointer(
  bundle: ReturnType<typeof validatePortableMachineSnapshotBundle>,
): bigint | undefined {
  const thread = bundle.nativeProcessImage.threads.threads.find(isActiveWriteThread);
  const raw = thread
    ? (thread.syscall.arguments?.[1] ?? activeReadRegisterBuffer(thread))
    : undefined;
  return raw === undefined ? undefined : safeBigInt(raw);
}

function activeTransferBufferPointer(
  bundle: ReturnType<typeof validatePortableMachineSnapshotBundle>,
): bigint | undefined {
  return activeReadBufferPointer(bundle) ?? activeWriteBufferPointer(bundle);
}

function safeBigIntNumber(value: string): number | undefined {
  const parsed = safeBigInt(value);
  return parsed === undefined ? undefined : Number(parsed);
}

function safeBigInt(value: string): bigint | undefined {
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function proofTwoThreadBindings(threadIds: [string, string]) {
  return threadIds.map((threadId, index) => ({
    threadId,
    stackBase: TARGET_THREAD_STACK_BASES[index],
    stackLimit: TARGET_THREAD_STACK_LIMITS[index],
    registers: {
      rip: "0x700300000000",
      rsp: TARGET_THREAD_STACK_LIMITS[index],
    },
  }));
}

function proofMemorySelection(bundle: ReturnType<typeof validatePortableMachineSnapshotBundle>) {
  const file = join(bundle.nativeProcessImage.rootDir!, NATIVE_PROCESS_IMAGE_FILES.memory);
  const sizeBytes = statSync(file).size;
  return {
    file,
    sizeBytes,
    mapping: selectProofMemoryMapping(
      bundle.nativeProcessImage.mappings.mappings,
      sizeBytes,
      activeTransferBufferPointer(bundle),
    ),
  };
}

function proofActiveSyscallPlan(
  continuations: Extract<
    ReturnType<typeof planNativeThreadRestoreBoundary>,
    { state: "accepted" }
  >["activeSyscallContinuations"],
) {
  return planTargetGuestActiveSyscallRestore({
    classifications: [],
    refusals: [],
    continuations,
  });
}

function combinedDescriptorPaths(
  args: Args,
  memoryFile: string,
  memorySizeBytes: number,
  mapping: NativeMemoryMapping,
): CombinedDescriptorPaths {
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
  targetFsBase: string | undefined,
  translatedReturnAddress: string | undefined,
  resumeMode: "translated-frame" | undefined,
  resumeRflags: string | undefined,
  resumeRegisters: ReturnType<typeof proofResumeRegisters> | undefined,
) {
  return {
    codeFile: GUEST_CODE,
    fileOffset: 0,
    codeSize: statSync(targetCodeFile).size,
    targetAddress: "0x700300000000",
    argument0,
    stateReportAddress,
    targetFsBase,
    translatedReturnAddress,
    resumeMode,
    resumeRflags,
    resumeRegisters,
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

function proofNativeRestoreSections(
  context: CombinedDescriptorContext,
  targetContinuation: PreparedTargetContinuation,
  memoryEntries: ReturnType<typeof proofMemoryPlan>["entries"],
): TargetGuestNativeRestoreStep[] {
  return [
    ...proofStackWindowNativeSections(targetContinuation),
    ...proofReturnChainNativeSections(targetContinuation),
    ...proofPrivateMemoryNativeSections(memoryEntries),
    ...proofExecutableNativeSections(targetContinuation),
    ...context.targetProcessContextSteps,
    ...proofSignalNativeSections(context),
    ...proofActiveSyscallNativeSections(context),
    ...proofThreadSpawnNativeSections(context),
  ];
}

function proofStackWindowNativeSections(
  targetContinuation: PreparedTargetContinuation,
): TargetGuestNativeRestoreStep[] {
  const frame = targetContinuation.translatedFrame;
  return frame
    ? [
        {
          section: "stack-window-write" as const,
          write: {
            mapping: "mapping:target-stack",
            targetAddress: frame.returnAddressSlot,
            offset: Number(BigInt(frame.returnAddressSlot) - BigInt(continuationStackStart())),
            sizeBytes: 8,
            value: frame.returnAddress,
            bytes: littleEndianU64(frame.returnAddress),
            kind: "return-address" as const,
          },
        },
        {
          section: "stack-window-guard" as const,
          guard: {
            targetStart: continuationStackLimit(),
            sizeBytes: 4096,
            placement: "above" as const,
          },
        },
      ]
    : [];
}

function proofReturnChainNativeSections(
  targetContinuation: PreparedTargetContinuation,
): TargetGuestNativeRestoreStep[] {
  const frame = targetContinuation.translatedFrame;
  return frame
    ? [
        {
          section: "return-chain-write" as const,
          write: {
            frameId: frame.unwindId,
            targetAddress: frame.returnAddressSlot,
            value: frame.returnAddress,
            bytes: littleEndianU64(frame.returnAddress),
            kind: "return-address" as const,
          },
        },
      ]
    : [];
}

function proofPrivateMemoryNativeSections(
  memoryEntries: ReturnType<typeof proofMemoryPlan>["entries"],
): TargetGuestNativeRestoreStep[] {
  const privatePlan = planTargetGuestPrivateMemoryRestore(memoryEntries);
  return privatePlan.state === "planned"
    ? privatePlan.steps.map((step) => ({ section: "private-memory" as const, step }))
    : [];
}

function proofExecutableNativeSections(
  targetContinuation: PreparedTargetContinuation,
): TargetGuestNativeRestoreStep[] {
  return [
    {
      section: "executable-mapping" as const,
      step: {
        action: "map-target-executable" as const,
        mapping: "mapping:target-continuation",
        targetStart: "0x700300000000",
        sizeBytes: targetContinuation.bytes.length,
        permissions: { read: true, write: false, execute: true, private: true, shared: false },
        path: GUEST_CODE,
        fileOffset: 0,
        sha256: sha256(targetContinuation.bytes),
        sourceTextReusedAsTargetCode: false as const,
      },
    },
  ];
}

function proofSignalNativeSections(
  context: CombinedDescriptorContext,
): TargetGuestNativeRestoreStep[] {
  const targetBlockedMasks = context.targetSignalBlockedMasks.length
    ? context.targetSignalBlockedMasks
    : ["0x0"];
  return [
    {
      section: "signal-restore" as const,
      step: {
        action: "save-loader-signal-mask" as const,
        threadId: context.targetThreadRestoreThreadId,
      },
    },
    {
      section: "signal-restore" as const,
      step: {
        action: "sigprocmask-set-blocked" as const,
        threadId: context.targetThreadRestoreThreadId,
        targetBlockedMasks,
      },
    },
    {
      section: "signal-restore" as const,
      step: {
        action: "verify-blocked-signal-mask" as const,
        threadId: context.targetThreadRestoreThreadId,
        targetBlockedMasks,
      },
    },
    {
      section: "signal-restore" as const,
      step: {
        action: "restore-loader-signal-mask" as const,
        threadId: context.targetThreadRestoreThreadId,
      },
    },
  ];
}

function proofActiveSyscallNativeSections(
  context: CombinedDescriptorContext,
): TargetGuestNativeRestoreStep[] {
  return context.targetActiveSyscallSteps.map((step) => ({
    section: "active-syscall" as const,
    step,
  }));
}

function activeFileReadProof(
  steps: CombinedDescriptorContext["targetActiveSyscallSteps"],
): ActiveFileReadProof | undefined {
  const step = steps.find((candidate) => candidate.action === "complete-fd-read-from-file");
  return step?.action === "complete-fd-read-from-file"
    ? {
        fd: step.fd,
        fileOffset: step.fileOffset,
        targetBufferPointer: step.targetBufferPointer,
        expectedBytes: PROOF_FILE_READ_BYTES.subarray(0, step.countBytes),
      }
    : undefined;
}

function activeFileWriteProof(
  steps: CombinedDescriptorContext["targetActiveSyscallSteps"],
): ActiveFileWriteProof | undefined {
  const step = steps.find((candidate) => candidate.action === "complete-fd-write-to-file");
  return step?.action === "complete-fd-write-to-file"
    ? {
        fd: step.fd,
        fileOffset: step.fileOffset,
        targetBufferPointer: step.targetBufferPointer,
        expectedBytes: PROOF_FILE_WRITE_BYTES.subarray(0, step.countBytes),
      }
    : undefined;
}

function proofFdFileBytes(context: CombinedDescriptorContext): Buffer {
  return proofFdExpectedBytes(context, false);
}

function proofFdVerifierBytes(context: CombinedDescriptorContext): Buffer {
  return proofFdExpectedBytes(context, true);
}

function proofFdExpectedBytes(
  context: CombinedDescriptorContext,
  includeActiveWrite: boolean,
): Buffer {
  const activeRead = context.activeFileReadProof;
  const activeWrite = includeActiveWrite ? context.activeFileWriteProof : undefined;
  const size = Math.max(
    PROOF_FD_BYTES.length,
    activeRead ? activeRead.fileOffset + activeRead.expectedBytes.length : 0,
    activeWrite ? activeWrite.fileOffset + activeWrite.expectedBytes.length : 0,
  );
  const bytes = Buffer.alloc(size, 0);
  PROOF_FD_BYTES.copy(bytes, 0);
  activeRead?.expectedBytes.copy(bytes, activeRead.fileOffset);
  activeWrite?.expectedBytes.copy(bytes, activeWrite.fileOffset);
  return bytes;
}

function proofThreadSpawnNativeSections(
  context: CombinedDescriptorContext,
): TargetGuestNativeRestoreStep[] {
  return context.targetThreadSpawnSteps.map((step) => ({
    section: "thread-spawn" as const,
    step,
  }));
}

function continuationStackStart(): string {
  return "0x500000000000";
}

function continuationStackLimit(): string {
  return "0x500000010000";
}

function littleEndianU64(value: string): string {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes.toString("hex");
}

function proofResumeRegisters() {
  return {
    rax: RESUME_REGISTER_RAX,
    rdi: RESUME_REGISTER_RDI,
    rsi: RESUME_REGISTER_RSI,
    rdx: RESUME_REGISTER_RDX,
    rcx: RESUME_REGISTER_RCX,
    r8: RESUME_REGISTER_R8,
    r9: RESUME_REGISTER_R9,
    r10: RESUME_REGISTER_R10,
    r11: RESUME_REGISTER_R11,
  };
}

function proofFdTable(context: CombinedDescriptorContext) {
  return planNativeTargetFdTable({
    resources: proofFdResources(context),
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
  const frameSummary = translatedFrameInvocationSummary(targetContinuation);
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
    targetTlsRestoreResult: targetContinuation.targetFsBase ? "pending" : undefined,
    ...nativeRestorePendingSummary(descriptorPlan.descriptor.nativeRestore ?? []),
    ...frameSummary,
    targetThreadRestoreResult: context.targetThreadRestoreResult,
    targetThreadRestoreThreadId: context.targetThreadRestoreThreadId,
  };
}

function translatedFrameInvocationSummary(targetContinuation: PreparedTargetContinuation) {
  return targetContinuation.translatedFrame
    ? {
        targetTranslatedFramePointer: targetContinuation.translatedFrame.framePointer,
        targetRegisterRestoreResult: "pending" as const,
        targetRflagsRestoreResult: "pending" as const,
        targetResumePathResult: "pending" as const,
        targetResumePathMode: "translated-frame" as const,
      }
    : {};
}

function nativeRestorePendingSummary(nativeRestore: TargetGuestNativeRestoreStep[]) {
  const sections = new Set(nativeRestore.map((step) => step.section));
  return {
    targetStackWindowMaterializationResult: pendingIfAnySection(sections, [
      "stack-window-write",
      "stack-window-guard",
    ]),
    targetPrivateMemoryRestoreResult: pendingIfAnySection(sections, ["private-memory"]),
    targetExecutableMappingResult: pendingIfAnySection(sections, ["executable-mapping"]),
    targetProcessContextRestoreResult: pendingIfAnySection(sections, ["process-context"]),
    targetSignalRestoreResult: pendingIfAnySection(sections, ["signal-restore"]),
    targetActiveSyscallRestoreResult: pendingIfAnySection(sections, ["active-syscall"]),
  };
}

function pendingIfAnySection(
  sections: Set<TargetGuestNativeRestoreStep["section"]>,
  candidates: Array<TargetGuestNativeRestoreStep["section"]>,
): "pending" | undefined {
  return candidates.some((section) => sections.has(section)) ? "pending" : undefined;
}

function prepareTargetContinuation(
  args: Args,
  targetDir: string,
  memoryFile: string,
  mapping: NativeMemoryMapping,
  activeFileRead: ActiveFileReadProof | undefined,
  expectedFdBytes: Buffer,
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
): PreparedTargetContinuation | ReturnType<typeof planPortableMachineVmRestoreProof> {
  const expectedMemoryByte = firstByte(memoryFile, mapping);
  return args.realUtilityContinuation
    ? prepareRealUtilityContinuation(
        targetDir,
        expectedMemoryByte,
        activeFileRead,
        expectedFdBytes,
        plan,
      )
    : {
        kind: "generated-verifier",
        bytes: combinedProofTargetCode(expectedMemoryByte, activeFileRead, expectedFdBytes),
      };
}

function prepareRealUtilityContinuation(
  targetDir: string,
  expectedMemoryByte: number,
  activeFileRead: ActiveFileReadProof | undefined,
  expectedFdBytes: Buffer,
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
) {
  const targetRoot = join(targetDir, "real-utility-root");
  const modulePath = join(targetRoot, "usr/bin/realspin-code");
  mkdirSync(dirname(modulePath), { recursive: true });
  const targetCode = stateConsumingRealUtilityTargetCode(
    expectedMemoryByte,
    activeFileRead,
    expectedFdBytes,
  );
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
    stateReportAddress: PROOF_MEMORY_TARGET,
    targetFsBase: TARGET_TLS_BASE,
    translatedReturnAddress: targetCode.translatedReturnAddress,
    translatedFrame: translatedFrameDescriptor(targetCode.translatedReturnAddress),
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

function translatedFrameDescriptor(returnAddress: string): TargetGuestTranslatedFrameDescriptor {
  return {
    kind: "single-target-caller-frame",
    framePointer: TRANSLATED_FRAME_POINTER,
    canonicalFrameAddress: TRANSLATED_FRAME_CFA,
    returnAddressSlot: TRANSLATED_FRAME_RETURN_ADDRESS_SLOT,
    returnAddress,
    unwindId: TRANSLATED_FRAME_UNWIND_ID,
    calleeSaved: [
      { register: "rbx", value: TRANSLATED_FRAME_RBX },
      { register: "r12", value: TRANSLATED_FRAME_R12 },
      { register: "r13", value: TRANSLATED_FRAME_R13 },
      { register: "r14", value: TRANSLATED_FRAME_R14 },
      { register: "r15", value: TRANSLATED_FRAME_R15 },
    ],
    slots: [
      {
        offset: TRANSLATED_FRAME_SLOT_OFFSET,
        value: hex(TRANSLATED_FRAME_MARKER),
        classification: "non-pointer-data",
      },
      {
        offset: TRANSLATED_FRAME_SECOND_SLOT_OFFSET,
        value: hex(TRANSLATED_FRAME_SECOND_SLOT_MARKER),
        classification: "non-pointer-data",
      },
    ],
  };
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

// fallow-ignore-next-line complexity
function selectProofMemoryMapping(
  mappings: NativeMemoryMapping[],
  memorySizeBytes: number,
  preferredSourceAddress?: bigint,
): NativeMemoryMapping | undefined {
  const candidates = mappings.filter((mapping) => proofMemoryCandidate(mapping, memorySizeBytes));
  const candidate = preferredSourceAddress
    ? (candidates.find((mapping) => mappingContains(mapping, preferredSourceAddress)) ??
      candidates[0])
    : candidates[0];
  if (!candidate?.captured) {
    return undefined;
  }
  return proofMemoryPage(candidate, memorySizeBytes, preferredSourceAddress);
}

function proofMemoryCandidate(mapping: NativeMemoryMapping, memorySizeBytes: number): boolean {
  const captured = mapping.captured;
  return [
    mapping.permissions.write,
    !mapping.permissions.execute,
    mapping.target.materialization === "translate",
    captured !== undefined,
    captured ? captured.offset < memorySizeBytes : false,
    captured ? captured.sizeBytes > 0 : false,
  ].every(Boolean);
}

function proofMemoryPage(
  mapping: NativeMemoryMapping,
  memorySizeBytes: number,
  preferredSourceAddress?: bigint,
): NativeMemoryMapping {
  const captured = mapping.captured!;
  const sourceStart = BigInt(mapping.sourceStart);
  const pageStart =
    preferredSourceAddress && mappingContains(mapping, preferredSourceAddress)
      ? alignDown(preferredSourceAddress, BigInt(PROOF_MEMORY_SIZE))
      : sourceStart;
  const offsetInMapping = pageStart - sourceStart;
  const capturedOffset = captured.offset + Number(offsetInMapping);
  const capturedLimit = captured.offset + captured.sizeBytes;
  const available = Math.min(
    PROOF_MEMORY_SIZE,
    memorySizeBytes - capturedOffset,
    capturedLimit - capturedOffset,
  );
  return {
    ...mapping,
    id: `${mapping.id}:combined-proof-page`,
    sourceStart: hex(pageStart),
    sourceEnd: hex(pageStart + BigInt(available)),
    sizeBytes: available,
    captured: {
      file: NATIVE_PROCESS_IMAGE_FILES.memory,
      offset: capturedOffset,
      sizeBytes: available,
    },
    target: {
      materialization: "translate",
      targetStart: PROOF_MEMORY_TARGET,
      reason: "combined target VM proof materializes one safe captured page",
    },
  };
}

function mappingContains(mapping: NativeMemoryMapping, address: bigint): boolean {
  return address >= BigInt(mapping.sourceStart) && address < BigInt(mapping.sourceEnd);
}

function alignDown(value: bigint, alignment: bigint): bigint {
  return value - (value % alignment);
}

function proofFdResources(context: CombinedDescriptorContext): NativeProcessResource[] {
  return [
    proofStdoutResource(),
    proofFileResource(),
    ...activeFileReadResources(context),
    ...activeFileWriteResources(context),
    proofPipeResource(PROOF_PIPE_READ_FD, "read"),
    proofPipeResource(PROOF_PIPE_WRITE_FD, "write"),
    proofSyntheticResource("eventfd", PROOF_EVENT_FD),
    proofSyntheticResource("timer", PROOF_TIMER_FD),
  ];
}

function activeFileReadResources(context: CombinedDescriptorContext): NativeProcessResource[] {
  const active = context.activeFileReadProof;
  return active
    ? [
        {
          id: `fd:${active.fd}:combined-proof-file-read`,
          kind: "file" as const,
          state: "recipe" as const,
          fd: active.fd,
          path: GUEST_FD_FILE,
          offset: active.fileOffset,
          flags: ["octal:0"],
          recipe: { reopen: GUEST_FD_FILE, offset: active.fileOffset },
        },
      ]
    : [];
}

function activeFileWriteResources(context: CombinedDescriptorContext): NativeProcessResource[] {
  const active = context.activeFileWriteProof;
  return active
    ? [
        {
          id: `fd:${active.fd}:combined-proof-file-write`,
          kind: "file" as const,
          state: "recipe" as const,
          fd: active.fd,
          path: GUEST_FD_FILE,
          offset: active.fileOffset,
          flags: ["octal:1"],
          recipe: { reopen: GUEST_FD_FILE, offset: active.fileOffset },
        },
      ]
    : [];
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

function combinedProofTargetCode(
  expectedMemoryByte: number,
  activeFileRead: ActiveFileReadProof | undefined,
  expectedFdBytes: Buffer,
): Buffer {
  return proofStateVerifierTargetCode(expectedMemoryByte, "exit", activeFileRead, expectedFdBytes)
    .bytes;
}

function stateConsumingRealUtilityTargetCode(
  expectedMemoryByte: number,
  activeFileRead: ActiveFileReadProof | undefined,
  expectedFdBytes: Buffer,
): {
  bytes: Buffer;
  translatedReturnAddress: string;
} {
  const code = proofStateVerifierTargetCode(
    expectedMemoryByte,
    "return",
    activeFileRead,
    expectedFdBytes,
  );
  return {
    bytes: code.bytes,
    translatedReturnAddress: hex(0x700300000000n + BigInt(code.translatedReturnOffset)),
  };
}

type ProofCompletionMode = "exit" | "return";

function proofStateVerifierTargetCode(
  expectedMemoryByte: number,
  completion: ProofCompletionMode,
  activeFileRead: ActiveFileReadProof | undefined,
  expectedFdBytes: Buffer,
): { bytes: Buffer; translatedReturnOffset: number } {
  const asm = new Amd64ProofAssembler();
  if (completion === "return") {
    asm.preserveRbx();
    asm.captureResumeRegisters(BigInt(PROOF_MEMORY_TARGET));
    asm.checkTargetTls(BigInt(PROOF_MEMORY_TARGET), BigInt(TARGET_TLS_BASE));
    asm.checkTranslatedRbx();
    asm.movRbxImmediate(BigInt(PROOF_MEMORY_TARGET));
    asm.storeReportWord(16, 0n);
    asm.checkTranslatedFrame();
    asm.checkTranslatedResumePath();
  } else {
    asm.movRbxImmediate(BigInt(PROOF_MEMORY_TARGET));
  }
  asm.checkMemoryByte(expectedMemoryByte);
  asm.markStateCheck(completion, STATE_CHECK_MEMORY);
  if (activeFileRead) {
    asm.checkAbsoluteBytes(
      BigInt(activeFileRead.targetBufferPointer),
      activeFileRead.expectedBytes,
    );
  }
  asm.checkFdClosed(PROOF_CLOSED_FD);
  asm.markStateCheck(completion, STATE_CHECK_CLOSE_FD);
  asm.checkFdOpen(PROOF_STDOUT_FD);
  asm.markStateCheck(completion, STATE_CHECK_STDIO);
  asm.readAndCheck(PROOF_FILE_FD, expectedFdBytes);
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

  checkTranslatedRbx(): void {
    this.checkRbxImmediate(BigInt(TRANSLATED_FRAME_RBX));
  }

  captureResumeRegisters(reportAddress: bigint): void {
    this.storeRaxAtAbsolute(reportAddress + 136n);
    this.captureResumeRflags(reportAddress + 216n);
    this.movRaxImmediate(reportAddress);
    this.storeRegisterAtRaxReportOffset("rdi", 200);
    this.storeRegisterAtRaxReportOffset("rsi", 144);
    this.storeRegisterAtRaxReportOffset("rdx", 152);
    this.storeRegisterAtRaxReportOffset("rcx", 160);
    this.storeRegisterAtRaxReportOffset("r8", 168);
    this.storeRegisterAtRaxReportOffset("r9", 176);
    this.storeRegisterAtRaxReportOffset("r10", 184);
    this.storeRegisterAtRaxReportOffset("r11", 192);
    this.storeReportWordFromRaxBase(128, RESUME_REGISTER_MARKER);
    this.storeReportWordFromRaxBase(208, RESUME_RFLAGS_MARKER);
  }

  checkTargetTls(reportAddress: bigint, targetFsBase: bigint): void {
    this.loadFsU64(0);
    this.storeRaxAtAbsolute(reportAddress + 240n);
    this.checkRaxImmediate(targetFsBase);
    this.loadFsU64(0x40);
    this.storeRaxAtAbsolute(reportAddress + 232n);
    this.checkRaxImmediate(TLS_TCB_MARKER);
    this.movRaxImmediate(TLS_RESTORE_MARKER);
    this.storeRaxAtAbsolute(reportAddress + 224n);
  }

  movRbxImmediate(value: bigint): void {
    this.push(0x48, 0xbb);
    this.pushU64(value);
  }

  checkMemoryByte(expected: number): void {
    this.push(0x80, 0x3b, expected);
    this.jumpIfNotEqual();
  }

  checkTranslatedFrame(): void {
    this.checkRbpImmediate(BigInt(TRANSLATED_FRAME_POINTER));
    this.storeReportWord(TRANSLATED_FRAME_REGISTER_MASK_OFFSET, 0n);
    this.markTranslatedRegister(TRANSLATED_FRAME_REGISTER_MASK_RBX);
    this.checkR12Immediate(BigInt(TRANSLATED_FRAME_R12));
    this.markTranslatedRegister(TRANSLATED_FRAME_REGISTER_MASK_R12);
    this.checkR13Immediate(BigInt(TRANSLATED_FRAME_R13));
    this.markTranslatedRegister(TRANSLATED_FRAME_REGISTER_MASK_R13);
    this.checkR14Immediate(BigInt(TRANSLATED_FRAME_R14));
    this.markTranslatedRegister(TRANSLATED_FRAME_REGISTER_MASK_R14);
    this.checkR15Immediate(BigInt(TRANSLATED_FRAME_R15));
    this.markTranslatedRegister(TRANSLATED_FRAME_REGISTER_MASK_R15);
    this.checkAbsoluteU64(
      BigInt(TRANSLATED_FRAME_POINTER) + BigInt(TRANSLATED_FRAME_SLOT_OFFSET),
      TRANSLATED_FRAME_MARKER,
    );
    this.checkAbsoluteU64(
      BigInt(TRANSLATED_FRAME_POINTER) + BigInt(TRANSLATED_FRAME_SECOND_SLOT_OFFSET),
      TRANSLATED_FRAME_SECOND_SLOT_MARKER,
    );
    this.storeReportWord(32, TRANSLATED_FRAME_MARKER);
  }

  markTranslatedRegister(bit: number): void {
    this.push(0x48, 0x83, 0x4b, TRANSLATED_FRAME_REGISTER_MASK_OFFSET, bit);
  }

  checkTranslatedResumePath(): void {
    this.checkRspImmediate(BigInt(TRANSLATED_FRAME_RETURN_ADDRESS_SLOT) - 8n);
    this.storeReportWord(40, TRANSLATED_RESUME_MARKER);
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

  captureResumeRflags(address: bigint): void {
    this.push(0x9c, 0x58);
    this.storeRaxAtAbsolute(address);
  }

  storeReportWord(offset: number, value: bigint): void {
    this.push(0x48, 0xb8);
    this.pushU64(value);
    this.push(0x48, 0x89, 0x43, offset);
  }

  storeReportWordFromRaxBase(offset: number, value: bigint): void {
    this.push(0x48, 0xba);
    this.pushU64(value);
    this.storeRegisterToRaxOffset(0x48, 0x50, 0x90, offset);
  }

  storeRegisterAtRaxReportOffset(
    register: "rdi" | "rsi" | "rdx" | "rcx" | "r8" | "r9" | "r10" | "r11",
    offset: number,
  ): void {
    const encodings = {
      rdi: { prefix: 0x48, modrm8: 0x78, modrm32: 0xb8 },
      rsi: { prefix: 0x48, modrm8: 0x70, modrm32: 0xb0 },
      rdx: { prefix: 0x48, modrm8: 0x50, modrm32: 0x90 },
      rcx: { prefix: 0x48, modrm8: 0x48, modrm32: 0x88 },
      r8: { prefix: 0x4c, modrm8: 0x40, modrm32: 0x80 },
      r9: { prefix: 0x4c, modrm8: 0x48, modrm32: 0x88 },
      r10: { prefix: 0x4c, modrm8: 0x50, modrm32: 0x90 },
      r11: { prefix: 0x4c, modrm8: 0x58, modrm32: 0x98 },
    };
    const encoding = encodings[register];
    this.storeRegisterToRaxOffset(encoding.prefix, encoding.modrm8, encoding.modrm32, offset);
  }

  private storeRaxAtAbsolute(address: bigint): void {
    this.push(0x48, 0xa3);
    this.pushU64(address);
  }

  private storeRegisterToRaxOffset(
    prefix: number,
    modrm8: number,
    modrm32: number,
    offset: number,
  ): void {
    if (offset <= 127) {
      this.push(prefix, 0x89, modrm8, offset);
      return;
    }
    this.push(prefix, 0x89, modrm32);
    this.pushU32(offset);
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

  private loadFsU64(offset: number): void {
    this.push(0x64, 0x48, 0x8b, 0x04, 0x25);
    this.pushU32(offset);
  }

  private checkRaxImmediate(expected: bigint): void {
    this.movRdxImmediate(expected);
    this.push(0x48, 0x39, 0xd0);
    this.jumpIfNotEqual();
  }

  private checkRbpImmediate(expected: bigint): void {
    this.movRaxImmediate(expected);
    this.push(0x48, 0x39, 0xe8);
    this.jumpIfNotEqual();
  }

  private checkRbxImmediate(expected: bigint): void {
    this.movRaxImmediate(expected);
    this.push(0x48, 0x39, 0xc3);
    this.jumpIfNotEqual();
  }

  private checkR12Immediate(expected: bigint): void {
    this.movRaxImmediate(expected);
    this.push(0x49, 0x39, 0xc4);
    this.jumpIfNotEqual();
  }

  private checkR13Immediate(expected: bigint): void {
    this.movRaxImmediate(expected);
    this.push(0x49, 0x39, 0xc5);
    this.jumpIfNotEqual();
  }

  private checkR14Immediate(expected: bigint): void {
    this.movRaxImmediate(expected);
    this.push(0x49, 0x39, 0xc6);
    this.jumpIfNotEqual();
  }

  private checkR15Immediate(expected: bigint): void {
    this.movRaxImmediate(expected);
    this.push(0x49, 0x39, 0xc7);
    this.jumpIfNotEqual();
  }

  private checkRspImmediate(expected: bigint): void {
    this.movRaxImmediate(expected);
    this.push(0x48, 0x39, 0xc4);
    this.jumpIfNotEqual();
  }

  checkAbsoluteBytes(address: bigint, expected: Buffer): void {
    for (const [index, byte] of expected.entries()) {
      this.movRaxImmediate(address + BigInt(index));
      this.push(0x80, 0x38, byte);
      this.jumpIfNotEqual();
    }
  }

  private checkAbsoluteU64(address: bigint, expected: bigint): void {
    this.movRaxImmediate(address);
    this.push(0x48, 0x8b, 0x10);
    this.movRaxImmediate(expected);
    this.push(0x48, 0x39, 0xc2);
    this.jumpIfNotEqual();
  }

  private movRaxImmediate(value: bigint): void {
    this.push(0x48, 0xb8);
    this.pushU64(value);
  }

  private movRdxImmediate(value: bigint): void {
    this.push(0x48, 0xba);
    this.pushU64(value);
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

function firstRefusedPlan(
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
  refusals: Array<{ code: string; message: string }>,
): ReturnType<typeof planPortableMachineVmRestoreProof> {
  const first = refusals[0]!;
  return refusedPlan(plan, first.code, first.message);
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
