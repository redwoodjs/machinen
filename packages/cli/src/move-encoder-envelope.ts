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
type MoveBase64State = NonNullable<MoveCapture["base64State"]>;
type MoveGzipState = NonNullable<MoveCapture["gzipState"]>;
type MoveGunzipState = NonNullable<MoveCapture["gunzipState"]>;
type MoveXzState = NonNullable<MoveCapture["xzState"]>;
type MoveZstdState = NonNullable<MoveCapture["zstdState"]>;
type MoveAtomicEncoderState = MoveGzipState | MoveGunzipState | MoveXzState | MoveZstdState;
type MoveAtomicEncoderCommand = "gzip" | "gunzip" | "xz" | "zstd";
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveBase64StateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["base64State"]> {
  const path = moveSingleFileCommand(node, "base64");
  const fileIdentity = path ? await readMoveFileIdentityInVm(vm, path) : undefined;
  return path && fileIdentity
    ? {
        path,
        wrap: 76,
        fileIdentity,
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveGzipStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["gzipState"]> {
  return readMoveAtomicEncoderStateInVm(vm, node, resourcePlan, "gzip");
}

export async function readMoveGunzipStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["gunzipState"]> {
  return readMoveAtomicEncoderStateInVm(vm, node, resourcePlan, "gunzip");
}

export async function readMoveXzStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["xzState"]> {
  return readMoveAtomicEncoderStateInVm(vm, node, resourcePlan, "xz");
}

export async function readMoveZstdStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["zstdState"]> {
  return readMoveAtomicEncoderStateInVm(vm, node, resourcePlan, "zstd");
}

async function readMoveAtomicEncoderStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  command: MoveAtomicEncoderCommand,
): Promise<MoveAtomicEncoderState | undefined> {
  const inputPath = moveAtomicEncoderInputPath(node, command);
  const outputPath = moveStdoutFilePath(resourcePlan) ?? (await readMoveStdoutFdPathInVm(vm, node));
  const fileIdentity = inputPath ? await readMoveFileIdentityInVm(vm, inputPath) : undefined;
  return inputPath && outputPath && fileIdentity
    ? {
        inputPath,
        outputPath,
        fileIdentity,
        outputPolicy: "atomic-temp-rename",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetBase64LoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.base64State;
  return runSimpleMoveLoader(
    vm,
    "target-original-base64-file-loader",
    executable,
    [executable, state?.path ?? ""],
    moveBase64LoaderCommand(executable, state),
    "base64-file",
    "target base64 file loader failed",
  );
}

export async function runMoveTargetGzipLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  return runMoveTargetAtomicEncoderLoaderInVm(vm, descriptor, "gzip");
}

export async function runMoveTargetGunzipLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  return runMoveTargetAtomicEncoderLoaderInVm(vm, descriptor, "gunzip");
}

export async function runMoveTargetXzLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  return runMoveTargetAtomicEncoderLoaderInVm(vm, descriptor, "xz");
}

export async function runMoveTargetZstdLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  return runMoveTargetAtomicEncoderLoaderInVm(vm, descriptor, "zstd");
}

async function runMoveTargetAtomicEncoderLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
  command: MoveAtomicEncoderCommand,
): Promise<MoveLoadDirectLoader> {
  const executable = moveAtomicEncoderExecutable(descriptor, command);
  const state = moveAtomicEncoderState(descriptor, command);
  return runSimpleMoveLoader(
    vm,
    moveAtomicEncoderStrategy(command),
    executable,
    [executable, "-c", state?.inputPath ?? ""],
    moveAtomicEncoderLoaderCommand(executable, state, command),
    `${command}-atomic`,
    `target ${command} atomic loader failed`,
  );
}

function moveSingleFileCommand(node: MovePidGraphNode, command: string): string | undefined {
  if (moveCommandName(node) !== command || node.argv.length !== 2) {
    return undefined;
  }
  const path = node.argv[1];
  return path?.startsWith("/") ? path : undefined;
}

function moveAtomicEncoderInputPath(
  node: MovePidGraphNode,
  command: MoveAtomicEncoderCommand,
): string | undefined {
  if (command === "gunzip" && moveCommandName(node) === "gzip") {
    const path =
      node.argv.length === 4 && node.argv[1] === "-d" && node.argv[2] === "-c"
        ? node.argv[3]
        : undefined;
    return path?.startsWith("/") ? path : undefined;
  }
  if (moveCommandName(node) !== command || node.argv.length !== 3 || node.argv[1] !== "-c") {
    return undefined;
  }
  const path = node.argv[2];
  return path?.startsWith("/") ? path : undefined;
}

function moveBase64LoaderCommand(executable: string, state: MoveBase64State | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tbase64-file\\trefused\\tmissing-base64-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
${moveFileIdentityPreflight("base64-file", state.path, state.fileIdentity)}
${shellQuote(executable)} --wrap=${state.wrap} ${shellQuote(state.path)} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-base64-file-started\n'
printf 'PATCH\tbase64-file\tready\t%s\t%s\n' ${shellQuote(state.path)} ${shellQuote(String(state.wrap))}
`;
}

function moveAtomicEncoderExecutable(
  descriptor: MoveDescriptor,
  command: MoveAtomicEncoderCommand,
): string {
  return command === "gunzip" ? "/usr/bin/gunzip" : moveRendezvousExecutable(descriptor);
}

function moveAtomicEncoderStrategy(
  command: MoveAtomicEncoderCommand,
): MoveLoadDirectLoader["strategy"] {
  return command === "gzip"
    ? "target-original-gzip-atomic-loader"
    : command === "gunzip"
      ? "target-original-gunzip-atomic-loader"
      : command === "xz"
        ? "target-original-xz-atomic-loader"
        : "target-original-zstd-atomic-loader";
}

function moveAtomicEncoderState(
  descriptor: MoveDescriptor,
  command: MoveAtomicEncoderCommand,
): MoveAtomicEncoderState | undefined {
  const capture = descriptor.resourcePlan?.capture;
  return command === "gzip"
    ? capture?.gzipState
    : command === "gunzip"
      ? capture?.gunzipState
      : command === "xz"
        ? capture?.xzState
        : capture?.zstdState;
}

function moveAtomicEncoderLoaderCommand(
  executable: string,
  state: MoveAtomicEncoderState | undefined,
  command: MoveAtomicEncoderCommand,
): string {
  const patchName = `${command}-atomic`;
  if (!state) {
    return `printf 'PATCH\t${patchName}\trefused\tmissing-${command}-state\n'; exit 2`;
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const tempOutput = `${state.outputPath}.machinen-move-$$`;
  return `set -eu
log=${shellQuote(log)}
${moveFileIdentityPreflight(patchName, state.inputPath, state.fileIdentity)}
rm -f ${shellQuote(tempOutput)}
if ! ${shellQuote(executable)} -c ${shellQuote(state.inputPath)} >${shellQuote(tempOutput)} 2>"$log"; then
  rm -f ${shellQuote(tempOutput)}
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\t${patchName}\trefused\t${command}-failed\n'
  exit 2
fi
mv -f ${shellQuote(tempOutput)} ${shellQuote(state.outputPath)}
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-${command}-atomic-completed\n'
printf 'PATCH\t${patchName}\tready\t%s\t%s\n' ${shellQuote(state.inputPath)} ${shellQuote(state.outputPath)}
`;
}

function moveFileIdentityPreflight(
  patchName: string,
  path: string,
  fileIdentity: { size: number; sha256: string },
): string {
  return `if [ ! -f ${shellQuote(path)} ]; then
  printf 'PATCH\t${patchName}\trefused\tmissing-input\n'
  exit 2
fi
actual_size=$(stat -c %s ${shellQuote(path)})
actual_identity=$(sha256sum ${shellQuote(path)} | awk '{print $1}')
if [ "$actual_size" != ${shellQuote(String(fileIdentity.size))} ] || [ "$actual_identity" != ${shellQuote(fileIdentity.sha256)} ]; then
  printf 'PATCH\t${patchName}\trefused\tchanged-input-identity\n'
  exit 2
fi`;
}

async function readMoveStdoutFdPathInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<string | undefined> {
  const result = await vm.execRaw(`readlink /proc/${node.pid}/fd/1 2>/dev/null || true`, {
    execTimeoutMs: 10_000,
  });
  const path = result.stdout.trim();
  return result.exitCode === 0 && path.startsWith("/") && path !== "/dev/null" ? path : undefined;
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

function moveRendezvousExecutable(descriptor: MoveDescriptor): string {
  return (
    descriptor.resourcePlan?.capture?.executablePackage?.path ??
    descriptor.nodes[0]?.exe ??
    "/usr/bin/ping"
  );
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.argv[0] ?? node.command ?? node.exe);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
