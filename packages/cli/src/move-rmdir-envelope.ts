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
type MoveRmdirState = NonNullable<MoveCapture["rmdirState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveRmdirStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveCapture["rmdirState"]> {
  const path = moveRmdirPath(node);
  if (!path) {
    return undefined;
  }
  const parentPath = dirnamePath(path);
  const result = await vm.execRaw(moveRmdirPreflightCommand(path, parentPath), {
    execTimeoutMs: 10_000,
  });
  const [dirDev, dirInode, dirMode, parentDev, parentMode, digestLine] = result.stdout
    .trim()
    .split("\n");
  return result.exitCode === 0 &&
    dirDev &&
    dirInode &&
    /^[0-9a-f]+$/.test(dirMode ?? "") &&
    parentDev &&
    /^[0-9a-f]+$/.test(parentMode ?? "") &&
    /^[0-9a-f]{64}$/.test(digestLine ?? "")
    ? {
        path,
        parentPath,
        directoryIdentity: { dev: dirDev, inode: dirInode, mode: dirMode as string },
        parentIdentity: {
          dev: parentDev,
          mode: parentMode as string,
          entriesDigest: digestLine as string,
        },
        policy: "empty-directory-non-symlink-pre-remove",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetRmdirLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.rmdirState;
  const argv = [executable, state?.path ?? ""];
  const result = await vm.execRaw(moveRmdirLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "rmdir-dir");
  const refusals = moveNamedLoaderRefusals(patch, "target rmdir loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-rmdir-dir-loader",
    executable,
    argv,
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveRmdirPath(node: MovePidGraphNode): string | undefined {
  if (moveCommandName(node) !== "rmdir" || node.argv.length !== 2) {
    return undefined;
  }
  const path = node.argv[1];
  return path?.startsWith("/") && path !== "/" && safeAbsolutePath(path) ? path : undefined;
}

function moveRmdirPreflightCommand(path: string, parentPath: string): string {
  return `set -eu
path=${shellQuote(path)}
parent=${shellQuote(parentPath)}
[ -d "$path" ]
[ ! -L "$path" ]
[ -d "$parent" ]
[ ! -L "$parent" ]
[ -z "$(find "$path" -mindepth 1 -maxdepth 1 -print -quit)" ]
dir_dev=$(stat -c %d "$path")
dir_inode=$(stat -c %i "$path")
dir_mode=$(stat -c %f "$path")
parent_dev=$(stat -c %d "$parent")
parent_mode=$(stat -c %f "$parent")
entries=$(find "$parent" -mindepth 1 -maxdepth 1 -printf '%f\t%y\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')
printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$dir_dev" "$dir_inode" "$dir_mode" "$parent_dev" "$parent_mode" "$entries"
`;
}

function moveRmdirLoaderCommand(executable: string, state: MoveRmdirState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\trmdir-dir\\trefused\\tmissing-rmdir-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveRmdirPreflightCommand(state.path, state.parentPath)}} > /tmp/machinen-rmdir-preflight-$$.txt
actual_dir_dev=$(sed -n '1p' /tmp/machinen-rmdir-preflight-$$.txt)
actual_dir_inode=$(sed -n '2p' /tmp/machinen-rmdir-preflight-$$.txt)
actual_dir_mode=$(sed -n '3p' /tmp/machinen-rmdir-preflight-$$.txt)
actual_parent_dev=$(sed -n '4p' /tmp/machinen-rmdir-preflight-$$.txt)
actual_parent_mode=$(sed -n '5p' /tmp/machinen-rmdir-preflight-$$.txt)
actual_parent_digest=$(sed -n '6p' /tmp/machinen-rmdir-preflight-$$.txt)
rm -f /tmp/machinen-rmdir-preflight-$$.txt
if [ "$actual_dir_dev" != "$actual_parent_dev" ] || [ "$actual_dir_mode" != ${shellQuote(state.directoryIdentity.mode)} ]; then
  printf 'PATCH\trmdir-dir\trefused\tchanged-directory-identity\n'
  exit 2
fi
if [ "$actual_parent_mode" != ${shellQuote(state.parentIdentity.mode)} ] || [ "$actual_parent_digest" != ${shellQuote(state.parentIdentity.entriesDigest)} ]; then
  printf 'PATCH\trmdir-dir\trefused\tchanged-parent-identity\n'
  exit 2
fi
if ! ${shellQuote(executable)} ${shellQuote(state.path)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\trmdir-dir\trefused\trmdir-failed\n'
  exit 2
fi
if [ -e ${shellQuote(state.path)} ] || [ -L ${shellQuote(state.path)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\trmdir-dir\trefused\tpath-still-present-after-rmdir\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-rmdir-completed\n'
printf 'PATCH\trmdir-dir\tready\t%s\n' ${shellQuote(state.path)}
`;
}

function dirnamePath(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
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

function parseLogPath(stdout: string): string | undefined {
  return stdout
    .trim()
    .split("\n")
    .find((row) => row.startsWith("LOAD_LOG\t"))
    ?.split("\t")[1];
}

function moveRendezvousExecutable(descriptor: MoveDescriptor): string {
  return (
    descriptor.resourcePlan?.capture?.executablePackage?.path ??
    descriptor.nodes[0]?.exe ??
    "/usr/bin/rmdir"
  );
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.argv[0] ?? node.command ?? node.exe);
}

function safeAbsolutePath(path: string): boolean {
  return path.split("/").filter(Boolean).every(isSafePathComponent);
}

function isSafePathComponent(component: string): boolean {
  return component !== "." && component !== ".." && !component.includes("\0");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
