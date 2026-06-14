import type {
  MoveDescriptor,
  MovePidGraphNode,
  NativeProcessImageRefusal,
  VmHandle,
} from "@machinen/runtime";
import { basename } from "node:path";

import type { MoveLoadDirectLoader } from "./move-rendezvous.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type MoveCapture = NonNullable<MoveResourcePlan["capture"]>;
type MoveChecksumState = NonNullable<MoveCapture["checksumState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

type MoveChecksumAlgorithm = MoveChecksumState["algorithm"];

const checksumCommands: Record<string, MoveChecksumAlgorithm> = {
  md5sum: "md5",
  sha1sum: "sha1",
  sha512sum: "sha512",
};

const checksumDigestPatterns: Record<MoveChecksumAlgorithm, RegExp> = {
  md5: /^[0-9a-f]{32}$/,
  sha1: /^[0-9a-f]{40}$/,
  sha512: /^[0-9a-f]{128}$/,
};

export async function readMoveChecksumStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["checksumState"]> {
  const parsed = moveChecksumFileState(node);
  if (!parsed) {
    return undefined;
  }
  const [expectedDigest, fileIdentity] = await Promise.all([
    readMoveChecksumDigestInVm(vm, parsed.command, parsed.path, parsed.algorithm),
    readMoveFileIdentityInVm(vm, parsed.path),
  ]);
  return expectedDigest && fileIdentity
    ? {
        algorithm: parsed.algorithm,
        path: parsed.path,
        expectedDigest,
        fileIdentity,
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetChecksumLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.checksumState;
  return runSimpleMoveLoader(
    vm,
    "target-original-checksum-file-loader",
    executable,
    [executable, state?.path ?? ""],
    moveChecksumLoaderCommand(executable, state),
    "checksum-file",
    "target checksum file loader failed",
  );
}

function moveChecksumFileState(
  node: MovePidGraphNode,
): { command: string; algorithm: MoveChecksumAlgorithm; path: string } | undefined {
  const command = moveCommandName(node);
  const algorithm = checksumCommands[command];
  const path = node.argv[1];
  return algorithm && node.argv.length === 2 && path?.startsWith("/")
    ? { command, algorithm, path }
    : undefined;
}

async function readMoveChecksumDigestInVm(
  vm: VmHandle,
  command: string,
  path: string,
  algorithm: MoveChecksumAlgorithm,
): Promise<string | undefined> {
  const result = await vm.execRaw(
    `[ -f ${shellQuote(path)} ] && ${shellQuote(command)} ${shellQuote(path)} | awk '{print $1}'`,
    { execTimeoutMs: 10_000 },
  );
  const digest = result.stdout.trim();
  return result.exitCode === 0 && checksumDigestPatterns[algorithm].test(digest)
    ? digest
    : undefined;
}

async function readMoveFileIdentityInVm(
  vm: VmHandle,
  path: string,
): Promise<{ size: number; sha256: string } | undefined> {
  const quoted = shellQuote(path);
  const result = await vm.execRaw(
    `[ -f ${quoted} ] && stat -c %s ${quoted} && sha256sum ${quoted} | awk '{print $1}'`,
    { execTimeoutMs: 10_000 },
  );
  const [sizeLine, digestLine] = result.stdout.trim().split("\n");
  const size = Number(sizeLine);
  return result.exitCode === 0 &&
    Number.isInteger(size) &&
    size >= 0 &&
    /^[0-9a-f]{64}$/.test(digestLine ?? "")
    ? { size, sha256: digestLine as string }
    : undefined;
}

function moveChecksumLoaderCommand(
  executable: string,
  state: MoveChecksumState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tchecksum-file\\trefused\\tmissing-checksum-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
${moveChecksumPreflight(executable, state)}
${shellQuote(executable)} ${shellQuote(state.path)} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-checksum-file-started\n'
printf 'PATCH\tchecksum-file\tready\t%s\t%s\n' ${shellQuote(state.algorithm)} ${shellQuote(state.path)}
`;
}

function moveChecksumPreflight(executable: string, state: MoveChecksumState): string {
  return `if [ ! -f ${shellQuote(state.path)} ]; then
  printf 'PATCH\tchecksum-file\trefused\tmissing-input\n'
  exit 2
fi
actual_size=$(stat -c %s ${shellQuote(state.path)})
actual_identity=$(sha256sum ${shellQuote(state.path)} | awk '{print $1}')
if [ "$actual_size" != ${shellQuote(String(state.fileIdentity.size))} ] || [ "$actual_identity" != ${shellQuote(state.fileIdentity.sha256)} ]; then
  printf 'PATCH\tchecksum-file\trefused\tchanged-input-identity\n'
  exit 2
fi
actual_digest=$(${shellQuote(executable)} ${shellQuote(state.path)} | awk '{print $1}')
if [ "$actual_digest" != ${shellQuote(state.expectedDigest)} ]; then
  printf 'PATCH\tchecksum-file\trefused\tchanged-input-digest\n'
  exit 2
fi`;
}

async function runSimpleMoveLoader(
  vm: VmHandle,
  strategy: MoveLoadDirectLoader["strategy"],
  executable: string,
  argv: string[],
  command: string,
  patchName: string,
  refusalMessage: string,
): Promise<MoveLoadDirectLoader> {
  const result = await vm.execRaw(command, { execTimeoutMs: 300_000 });
  const parsed = parseRendezvousOutput(result.stdout);
  const patch = moveNamedPatchFromOutput(result, patchName);
  const refusals = moveNamedLoaderRefusals(patch, refusalMessage);
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy,
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    patch,
    refusals,
  };
}

function moveRendezvousExecutable(descriptor: MoveDescriptor): string {
  return (
    descriptor.resourcePlan?.capture?.executablePackage?.path ??
    descriptor.nodes[0]?.exe ??
    "/usr/bin/ping"
  );
}

function parseRendezvousOutput(stdout: string): { pid?: number; logPath?: string } {
  const rows = stdout.trim().split("\n");
  const pid = Number(rows.find((row) => row.startsWith("LOAD_PID\t"))?.split("\t")[1]);
  const logPath = rows.find((row) => row.startsWith("LOAD_LOG\t"))?.split("\t")[1];
  return { pid: Number.isInteger(pid) && pid > 0 ? pid : undefined, logPath };
}

function moveNamedPatchFromOutput(
  result: { stdout: string; stderr: string; exitCode: number },
  patchName: string,
): MovePatch {
  const state =
    result.exitCode === 0 && result.stdout.includes(`PATCH\t${patchName}\tready`)
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

function moveNamedLoaderRefusals(
  patch: MovePatch | undefined,
  message: string,
): NativeProcessImageRefusal[] {
  return patch?.state === "ready"
    ? []
    : [{ code: "target-process-context-unsupported", message, detail: { patch } }];
}

function moveStdoutFilePath(resourcePlan: MoveResourcePlan): string | undefined {
  const stdout = resourcePlan.resources.find((resource) => resource.fd === 1);
  return stdout?.kind === "file" && typeof stdout.path === "string" ? stdout.path : undefined;
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.exe ?? node.argv[0] ?? node.command);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
