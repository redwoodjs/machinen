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
type MoveSymlinkState = NonNullable<MoveCapture["symlinkState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveSymlinkStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveCapture["symlinkState"]> {
  const target = moveSymlinkTarget(node);
  if (!target) {
    return undefined;
  }
  const parentPath = dirnamePath(target.linkPath);
  const result = await vm.execRaw(moveSymlinkPreflightCommand(target.linkPath, parentPath), {
    execTimeoutMs: 10_000,
  });
  const [devLine, modeLine, digestLine] = result.stdout.trim().split("\n");
  return result.exitCode === 0 &&
    devLine &&
    /^[0-9a-f]+$/.test(modeLine ?? "") &&
    /^[0-9a-f]{64}$/.test(digestLine ?? "")
    ? {
        targetLiteral: target.targetLiteral,
        linkPath: target.linkPath,
        parentPath,
        parentIdentity: {
          dev: devLine,
          mode: modeLine as string,
          entriesDigest: digestLine as string,
        },
        policy: "literal-target-absent-link-safe-parent",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetSymlinkLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.symlinkState;
  const argv = [executable, "-s", state?.targetLiteral ?? "", state?.linkPath ?? ""];
  const result = await vm.execRaw(moveSymlinkLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "symlink-file");
  const refusals = moveNamedLoaderRefusals(patch, "target symlink loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-symlink-file-loader",
    executable,
    argv,
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveSymlinkTarget(
  node: MovePidGraphNode,
): { targetLiteral: string; linkPath: string } | undefined {
  if (moveCommandName(node) !== "ln" || node.argv.length !== 4 || node.argv[1] !== "-s") {
    return undefined;
  }
  const targetLiteral = node.argv[2];
  const linkPath = node.argv[3];
  return isSafeSymlinkLiteral(targetLiteral) &&
    linkPath?.startsWith("/") &&
    linkPath !== "/" &&
    safeAbsolutePath(linkPath)
    ? { targetLiteral, linkPath }
    : undefined;
}

function moveSymlinkPreflightCommand(linkPath: string, parentPath: string): string {
  return `set -eu
link=${shellQuote(linkPath)}
parent=${shellQuote(parentPath)}
[ -d "$parent" ]
[ ! -L "$parent" ]
[ ! -e "$link" ]
[ ! -L "$link" ]
parent_dev=$(stat -c %d "$parent")
parent_mode=$(stat -c %f "$parent")
entries=$(find "$parent" -mindepth 1 -maxdepth 1 -printf '%f\t%y\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')
printf '%s\n%s\n%s\n' "$parent_dev" "$parent_mode" "$entries"
`;
}

function moveSymlinkLoaderCommand(executable: string, state: MoveSymlinkState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tsymlink-file\\trefused\\tmissing-symlink-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveSymlinkPreflightCommand(state.linkPath, state.parentPath)}} > /tmp/machinen-symlink-preflight-$$.txt
actual_dev=$(sed -n '1p' /tmp/machinen-symlink-preflight-$$.txt)
actual_mode=$(sed -n '2p' /tmp/machinen-symlink-preflight-$$.txt)
actual_digest=$(sed -n '3p' /tmp/machinen-symlink-preflight-$$.txt)
rm -f /tmp/machinen-symlink-preflight-$$.txt
if [ "$actual_dev" != ${shellQuote(state.parentIdentity.dev)} ] || [ "$actual_mode" != ${shellQuote(state.parentIdentity.mode)} ] || [ "$actual_digest" != ${shellQuote(state.parentIdentity.entriesDigest)} ]; then
  printf 'PATCH\tsymlink-file\trefused\tchanged-parent-identity\n'
  exit 2
fi
if ! ${shellQuote(executable)} -s ${shellQuote(state.targetLiteral)} ${shellQuote(state.linkPath)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tsymlink-file\trefused\tsymlink-failed\n'
  exit 2
fi
if [ ! -L ${shellQuote(state.linkPath)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tsymlink-file\trefused\tmissing-created-symlink\n'
  exit 2
fi
actual_target=$(readlink ${shellQuote(state.linkPath)})
if [ "$actual_target" != ${shellQuote(state.targetLiteral)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tsymlink-file\trefused\tchanged-created-target\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-symlink-completed\n'
printf 'PATCH\tsymlink-file\tready\t%s\t%s\n' ${shellQuote(state.targetLiteral)} ${shellQuote(state.linkPath)}
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
    "/usr/bin/ln"
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

function isSafeSymlinkLiteral(value: string | undefined): value is string {
  return Boolean(value) && !value.includes("\0") && !value.includes("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
