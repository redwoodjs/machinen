#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
import { planNativeTargetFdTable } from "../packages/runtime/src/native-resource-translation.ts";
import { validatePortableMachineSnapshotBundle } from "../packages/runtime/src/portable-machine-snapshot.ts";
import { planTargetGuestMemoryMaterialization } from "../packages/runtime/src/target-guest-memory-materialization.ts";
import { serializeTargetGuestRestoreDescriptor } from "../packages/runtime/src/target-guest-restore-loader.ts";

interface Args {
  bundleDir?: string;
  targetCodeFile?: string;
  image?: string;
  json: boolean;
  combinedDescriptor: boolean;
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

function usage(): never {
  console.error(
    "usage: tsx scripts/portable-machine-vm-restore-proof.ts verify " +
      "--bundle-dir path --target-code-file path [--image rootfs.tar.gz] " +
      "[--combined-descriptor] [--json]",
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
        targetVerifierResult: "pending",
      }
    : plan;
}

function prepareCombinedDescriptor(
  args: Args,
  plan: ReturnType<typeof planPortableMachineVmRestoreProof>,
): TargetInvocation | ReturnType<typeof planPortableMachineVmRestoreProof> {
  const bundle = validatePortableMachineSnapshotBundle(args.bundleDir!);
  const nativeRoot = bundle.nativeProcessImage.rootDir!;
  const memoryFile = join(nativeRoot, NATIVE_PROCESS_IMAGE_FILES.memory);
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

  const targetCodeFile = resolve(args.targetCodeFile!);
  const targetDir = dirname(targetCodeFile);
  const fdFile = join(targetDir, "combined-fd-resource.txt");
  const descriptorFile = join(targetDir, "combined-target-restore.desc");
  const pathRefusal = portableProofPathRefusal(bundle.rootDir!, {
    "target-code": targetCodeFile,
    "target-descriptor": descriptorFile,
    "target-fd-resource": fdFile,
    "target-memory": memoryFile,
  });
  if (pathRefusal) {
    return refusedPlan(plan, pathRefusal.code, pathRefusal.message);
  }
  writeFileSync(fdFile, PROOF_FD_BYTES);
  writeFileSync(targetCodeFile, combinedProofTargetCode(firstByte(memoryFile, mapping)));

  const continuation = {
    codeFile: GUEST_CODE,
    fileOffset: 0,
    codeSize: statSync(targetCodeFile).size,
    targetAddress: "0x700300000000",
    timeoutSeconds: 5,
    stackTargetStart: "0x500000000000",
    stackSize: 65_536,
    stackPointer: "0x500000010000",
  };
  const memory = planTargetGuestMemoryMaterialization({
    mappings: [mapping],
    memorySizeBytes,
    memoryFile: GUEST_MEMORY,
  });
  const fdTable = planNativeTargetFdTable({
    resources: proofFdResources(),
    expectedFds: [PROOF_CLOSED_FD],
    inheritedStdio: { mode: "inherit-output" },
    syntheticEmptyPipeFds: [PROOF_PIPE_READ_FD],
    syntheticEmptyEventFds: [PROOF_EVENT_FD],
    syntheticTimerFds: [PROOF_TIMER_FD],
  });
  const descriptorPlan = planPortableMachineTargetRestoreDescriptor({
    continuation,
    fdTable,
    memory,
  });
  if (descriptorPlan.state === "refused") {
    const first = descriptorPlan.refusals[0]!;
    return refusedPlan(plan, first.code, first.message);
  }
  writeFileSync(descriptorFile, serializeTargetGuestRestoreDescriptor(descriptorPlan.descriptor));
  return {
    descriptorFile,
    memoryFile,
    fdFile,
    descriptorMemoryEntryCount: descriptorPlan.memoryEntryCount,
    descriptorFdRecipeCount: descriptorPlan.fdRecipeCount,
    descriptorResourceKinds: descriptorPlan.descriptor.resources.map((resource) => resource.kind),
  };
}

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
  const bytes: number[] = [];
  const jumps: number[] = [];
  const push = (...values: number[]) => bytes.push(...values.map((value) => value & 0xff));
  const pushU32 = (value: number) => push(value, value >> 8, value >> 16, value >> 24);
  const pushU64 = (value: bigint) => {
    for (let i = 0n; i < 8n; i++) {
      push(Number((value >> (8n * i)) & 0xffn));
    }
  };
  const jumpToFail = (condition: number) => {
    push(0x0f, condition, 0x00, 0x00, 0x00, 0x00);
    jumps.push(bytes.length - 4);
  };
  const jumpIfNotEqual = () => jumpToFail(0x85);
  const jumpIfSign = () => jumpToFail(0x88);
  const syscall = (number: number) => {
    push(0xb8);
    pushU32(number);
  };
  const movFd = (fd: number) => {
    push(0xbf);
    pushU32(fd);
  };
  const checkFdOpen = (fd: number) => {
    syscall(72);
    movFd(fd);
    push(0xbe);
    pushU32(1);
    push(0x31, 0xd2, 0x0f, 0x05, 0x48, 0x85, 0xc0);
    jumpIfSign();
  };
  const checkFdClosed = (fd: number) => {
    syscall(72);
    movFd(fd);
    push(0xbe);
    pushU32(1);
    push(0x31, 0xd2, 0x0f, 0x05, 0x83, 0xf8, 0xf7);
    jumpIfNotEqual();
  };
  const readAndCheck = (fd: number, expected: Buffer) => {
    push(0x48, 0x83, 0xec, 0x10, 0x31, 0xc0);
    movFd(fd);
    push(0x48, 0x89, 0xe6, 0xba);
    pushU32(expected.length);
    push(0x0f, 0x05, 0x83, 0xf8, expected.length);
    jumpIfNotEqual();
    for (const [index, byte] of expected.entries()) {
      push(0x80, index === 0 ? 0x3c : 0x7c, 0x24);
      if (index !== 0) {
        push(index);
      }
      push(byte);
      jumpIfNotEqual();
    }
  };

  push(0x48, 0xbb);
  pushU64(BigInt(PROOF_MEMORY_TARGET));
  push(0x80, 0x3b, expectedMemoryByte);
  jumpIfNotEqual();
  checkFdClosed(PROOF_CLOSED_FD);
  checkFdOpen(PROOF_STDOUT_FD);
  readAndCheck(PROOF_FILE_FD, PROOF_FD_BYTES);
  checkFdOpen(PROOF_PIPE_READ_FD);
  checkFdOpen(PROOF_PIPE_WRITE_FD);
  checkFdOpen(PROOF_EVENT_FD);
  checkFdOpen(PROOF_TIMER_FD);
  syscall(60);
  push(0x31, 0xff, 0x0f, 0x05);

  const failOffset = bytes.length;
  syscall(60);
  push(0xbf);
  pushU32(42);
  push(0x0f, 0x05);

  for (const index of jumps) {
    const relative = failOffset - (index + 4);
    bytes[index] = relative & 0xff;
    bytes[index + 1] = (relative >> 8) & 0xff;
    bytes[index + 2] = (relative >> 16) & 0xff;
    bytes[index + 3] = (relative >> 24) & 0xff;
  }
  return Buffer.from(bytes);
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
