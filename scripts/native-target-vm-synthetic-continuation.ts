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

interface Args {
  codeFile?: string;
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
}

function usage(): never {
  console.error(
    "usage: tsx scripts/native-target-vm-synthetic-continuation.ts verify " +
      "--code-file path [--image rootfs.tar.gz] [--entry-address hex] " +
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
  try {
    return await executeTargetVmProof(args, { trampoline, loader }, vm);
  } finally {
    await killUnlessKept(vm, args.keep);
  }
}

function skipReason(args: Args): string | undefined {
  return (
    hostSkipReason() ||
    missingFileReason(args.codeFile, "--code-file") ||
    missingFileReason(args.image, IMAGE_ENV)
  );
}

function hostSkipReason(): string | undefined {
  const supported = process.platform === "linux" && process.arch === "x64";
  return supported ? undefined : "target VM synthetic proof requires Linux/amd64 host";
}

function missingFileReason(path: string | undefined, label: string): string | undefined {
  return path && existsSync(path) ? undefined : `${label} must point at an existing file`;
}

async function bootTargetVm(image: string) {
  return await boot({
    image: resolve(image),
    name: `target-vm-synthetic-${process.pid}`,
    cmd: ["/bin/sleep", "infinity"],
    vmmEnv: { ...process.env, MACHINEN_GUEST_ARCH: "amd64" },
  });
}

async function executeTargetVmProof(
  args: Args,
  helpers: { trampoline: string; loader: string },
  vm: Awaited<ReturnType<typeof boot>>,
) {
  const codeSize = statSync(args.codeFile!).size;
  await vm.writeFile(GUEST_TRAMPOLINE, readFileSync(helpers.trampoline), { mode: 0o755 });
  await vm.writeFile(GUEST_LOADER, readFileSync(helpers.loader), { mode: 0o755 });
  await vm.writeFile(GUEST_CODE, readFileSync(args.codeFile!));
  await vm.writeFile(
    GUEST_DESCRIPTOR,
    serializeTargetGuestRestoreDescriptor(targetDescriptor(args, codeSize)),
  );
  const result = await vm.execRaw(targetLoaderCommand(), {
    execTimeoutMs: (args.timeoutSeconds + 20) * 1000,
  });
  return {
    phase: "target-vm-synthetic-continuation",
    targetVmAttempted: true,
    targetGuestLoaderUsed: true,
    targetArch: "amd64",
    codeFile: resolve(args.codeFile!),
    codeFileBasename: basename(args.codeFile!),
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    migrationCompleted: result.exitCode === 0,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
  };
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
  return [pipeRecipe(args), eventfdRecipe(args)].filter((recipe) => recipe !== undefined);
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
