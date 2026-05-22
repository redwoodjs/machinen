#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
}

const GUEST_CODE = "/tmp/machinen-target-bytes.bin";
const GUEST_MEMORY = "/tmp/machinen-combined-native-memory.bin";
const GUEST_FD_FILE = "/tmp/machinen-combined-fd.txt";
const PROOF_MEMORY_TARGET = "0x600000000000";
const PROOF_MEMORY_SIZE = 4096;
const PROOF_FD = 7;
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
  return runTargetProof(args, plan, prepared);
}

function isRestorePlan(
  prepared: TargetInvocation | ReturnType<typeof planPortableMachineVmRestoreProof> | undefined,
): prepared is ReturnType<typeof planPortableMachineVmRestoreProof> {
  return prepared !== undefined && "state" in prepared;
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
  const fdTable = planNativeTargetFdTable({ resources: [proofFdResource()] });
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
  return { descriptorFile, memoryFile, fdFile };
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

function proofFdResource(): NativeProcessResource {
  return {
    id: `fd:${PROOF_FD}:combined-proof`,
    kind: "file",
    state: "recipe",
    fd: PROOF_FD,
    path: GUEST_FD_FILE,
    offset: 0,
    flags: ["octal:0"],
    recipe: { reopen: GUEST_FD_FILE, offset: 0 },
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
  const jumpToFail = () => {
    push(0x75, 0x00);
    jumps.push(bytes.length - 1);
  };

  push(0x48, 0xbb);
  pushU64(BigInt(PROOF_MEMORY_TARGET));
  push(0x80, 0x3b, expectedMemoryByte);
  jumpToFail();
  push(0x48, 0x83, 0xec, 0x10);
  push(0x31, 0xc0);
  push(0xbf);
  pushU32(PROOF_FD);
  push(0x48, 0x89, 0xe6);
  push(0xba);
  pushU32(PROOF_FD_BYTES.length);
  push(0x0f, 0x05);
  push(0x83, 0xf8, PROOF_FD_BYTES.length);
  jumpToFail();
  push(0x80, 0x3c, 0x24, PROOF_FD_BYTES[0]!);
  jumpToFail();
  push(0x80, 0x7c, 0x24, 0x01, PROOF_FD_BYTES[1]!);
  jumpToFail();
  push(0xb8);
  pushU32(60);
  push(0x31, 0xff, 0x0f, 0x05);

  const failOffset = bytes.length;
  push(0xb8);
  pushU32(60);
  push(0xbf);
  pushU32(42);
  push(0x0f, 0x05);

  for (const index of jumps) {
    bytes[index] = failOffset - (index + 1);
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
