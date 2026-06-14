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
type MoveRmState = NonNullable<MoveCapture["rmState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveRmStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveCapture["rmState"]> {
  const path = moveRmPath(node);
  if (!path) {
    return undefined;
  }
  const parentPath = dirnamePath(path);
  const result = await vm.execRaw(moveRmPreflightCommand(path, parentPath), {
    execTimeoutMs: 10_000,
  });
  const [modeLine, sizeLine, shaLine, parentDevLine, parentModeLine, digestLine] = result.stdout
    .trim()
    .split("\n");
  const size = Number(sizeLine);
  return result.exitCode === 0 &&
    /^[0-9a-f]+$/.test(modeLine ?? "") &&
    Number.isSafeInteger(size) &&
    /^[0-9a-f]{64}$/.test(shaLine ?? "") &&
    parentDevLine &&
    /^[0-9a-f]+$/.test(parentModeLine ?? "") &&
    /^[0-9a-f]{64}$/.test(digestLine ?? "")
    ? {
        path,
        parentPath,
        fileIdentity: { mode: modeLine as string, size, sha256: shaLine as string },
        parentIdentity: {
          dev: parentDevLine,
          mode: parentModeLine as string,
          entriesDigest: digestLine as string,
        },
        policy: "regular-non-symlink-pre-unlink",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetRmLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.rmState;
  const argv = [executable, state?.path ?? ""];
  const result = await vm.execRaw(moveRmLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "rm-file");
  const refusals = moveNamedLoaderRefusals(patch, "target rm loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-rm-file-loader",
    executable,
    argv,
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveRmPath(node: MovePidGraphNode): string | undefined {
  if (moveCommandName(node) !== "rm" || node.argv.length !== 2) {
    return undefined;
  }
  const path = node.argv[1];
  return path?.startsWith("/") && path !== "/" && safeAbsolutePath(path) ? path : undefined;
}

function moveRmPreflightCommand(path: string, parentPath: string): string {
  return `set -eu
path=${shellQuote(path)}
parent=${shellQuote(parentPath)}
[ -f "$path" ]
[ ! -L "$path" ]
[ -d "$parent" ]
[ ! -L "$parent" ]
mode=$(stat -c %f "$path")
size=$(stat -c %s "$path")
sha=$(sha256sum "$path" | awk '{print $1}')
parent_dev=$(stat -c %d "$parent")
parent_mode=$(stat -c %f "$parent")
entries=$(find "$parent" -mindepth 1 -maxdepth 1 -printf '%f\t%y\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')
printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$mode" "$size" "$sha" "$parent_dev" "$parent_mode" "$entries"
`;
}

function moveRmLoaderCommand(executable: string, state: MoveRmState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\trm-file\\trefused\\tmissing-rm-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveRmPreflightCommand(state.path, state.parentPath)}} > /tmp/machinen-rm-preflight-$$.txt
actual_mode=$(sed -n '1p' /tmp/machinen-rm-preflight-$$.txt)
actual_size=$(sed -n '2p' /tmp/machinen-rm-preflight-$$.txt)
actual_sha=$(sed -n '3p' /tmp/machinen-rm-preflight-$$.txt)
actual_parent_dev=$(sed -n '4p' /tmp/machinen-rm-preflight-$$.txt)
actual_parent_mode=$(sed -n '5p' /tmp/machinen-rm-preflight-$$.txt)
actual_parent_digest=$(sed -n '6p' /tmp/machinen-rm-preflight-$$.txt)
rm -f /tmp/machinen-rm-preflight-$$.txt
if [ "$actual_mode" != ${shellQuote(state.fileIdentity.mode)} ] || [ "$actual_size" != ${shellQuote(String(state.fileIdentity.size))} ] || [ "$actual_sha" != ${shellQuote(state.fileIdentity.sha256)} ]; then
  printf 'PATCH\trm-file\trefused\tchanged-file-identity\n'
  exit 2
fi
if [ "$actual_parent_dev" != ${shellQuote(state.parentIdentity.dev)} ] || [ "$actual_parent_mode" != ${shellQuote(state.parentIdentity.mode)} ] || [ "$actual_parent_digest" != ${shellQuote(state.parentIdentity.entriesDigest)} ]; then
  printf 'PATCH\trm-file\trefused\tchanged-parent-identity\n'
  exit 2
fi
if ! ${shellQuote(executable)} ${shellQuote(state.path)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\trm-file\trefused\trm-failed\n'
  exit 2
fi
if [ -e ${shellQuote(state.path)} ] || [ -L ${shellQuote(state.path)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\trm-file\trefused\tpath-still-present-after-rm\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-rm-completed\n'
printf 'PATCH\trm-file\tready\t%s\n' ${shellQuote(state.path)}
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
    "/usr/bin/rm"
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
