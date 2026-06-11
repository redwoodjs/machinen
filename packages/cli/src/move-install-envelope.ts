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
type MoveInstallState = NonNullable<MoveCapture["installState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveInstallStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveCapture["installState"]> {
  const target = moveInstallTarget(node);
  if (!target) {
    return undefined;
  }
  const destinationParent = dirnamePath(target.destinationPath);
  const result = await vm.execRaw(
    moveInstallPreflightCommand(target.sourcePath, target.destinationPath, destinationParent),
    { execTimeoutMs: 10_000 },
  );
  const [sourceMode, sizeLine, shaLine, parentDev, parentMode, digestLine] = result.stdout
    .trim()
    .split("\n");
  const size = Number(sizeLine);
  return result.exitCode === 0 &&
    /^[0-9a-f]+$/.test(sourceMode ?? "") &&
    Number.isSafeInteger(size) &&
    /^[0-9a-f]{64}$/.test(shaLine ?? "") &&
    parentDev &&
    /^[0-9a-f]+$/.test(parentMode ?? "") &&
    /^[0-9a-f]{64}$/.test(digestLine ?? "")
    ? {
        sourcePath: target.sourcePath,
        destinationPath: target.destinationPath,
        mode: target.mode,
        sourceIdentity: { mode: sourceMode as string, size, sha256: shaLine as string },
        destinationParent,
        destinationParentIdentity: {
          dev: parentDev,
          mode: parentMode as string,
          entriesDigest: digestLine as string,
        },
        policy: "copy-mode-absent-destination",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetInstallLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.installState;
  const argv = [
    executable,
    "-m",
    state?.mode ?? "",
    state?.sourcePath ?? "",
    state?.destinationPath ?? "",
  ];
  const result = await vm.execRaw(moveInstallLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "install-file");
  const refusals = moveNamedLoaderRefusals(patch, "target install loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-install-file-loader",
    executable,
    argv,
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveInstallTarget(
  node: MovePidGraphNode,
): { sourcePath: string; destinationPath: string; mode: string } | undefined {
  if (moveCommandName(node) !== "install" || node.argv.length !== 5 || node.argv[1] !== "-m") {
    return undefined;
  }
  const mode = normalizeMode(node.argv[2]);
  const sourcePath = node.argv[3];
  const destinationPath = node.argv[4];
  return mode &&
    sourcePath?.startsWith("/") &&
    destinationPath?.startsWith("/") &&
    sourcePath !== "/" &&
    destinationPath !== "/" &&
    sourcePath !== destinationPath &&
    safeAbsolutePath(sourcePath) &&
    safeAbsolutePath(destinationPath)
    ? { sourcePath, destinationPath, mode }
    : undefined;
}

function moveInstallPreflightCommand(
  sourcePath: string,
  destinationPath: string,
  destinationParent: string,
): string {
  return `set -eu
src=${shellQuote(sourcePath)}
dst=${shellQuote(destinationPath)}
parent=${shellQuote(destinationParent)}
[ -f "$src" ]
[ ! -L "$src" ]
[ -d "$parent" ]
[ ! -L "$parent" ]
[ ! -e "$dst" ]
[ ! -L "$dst" ]
source_mode=$(stat -c %f "$src")
source_size=$(stat -c %s "$src")
source_sha=$(sha256sum "$src" | awk '{print $1}')
parent_dev=$(stat -c %d "$parent")
parent_mode=$(stat -c %f "$parent")
entries=$(find "$parent" -mindepth 1 -maxdepth 1 -printf '%f\t%y\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')
printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$source_mode" "$source_size" "$source_sha" "$parent_dev" "$parent_mode" "$entries"
`;
}

function moveInstallLoaderCommand(executable: string, state: MoveInstallState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tinstall-file\\trefused\\tmissing-install-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveInstallPreflightCommand(state.sourcePath, state.destinationPath, state.destinationParent)}} > /tmp/machinen-install-preflight-$$.txt
actual_source_mode=$(sed -n '1p' /tmp/machinen-install-preflight-$$.txt)
actual_source_size=$(sed -n '2p' /tmp/machinen-install-preflight-$$.txt)
actual_source_sha=$(sed -n '3p' /tmp/machinen-install-preflight-$$.txt)
actual_parent_dev=$(sed -n '4p' /tmp/machinen-install-preflight-$$.txt)
actual_parent_mode=$(sed -n '5p' /tmp/machinen-install-preflight-$$.txt)
actual_parent_digest=$(sed -n '6p' /tmp/machinen-install-preflight-$$.txt)
rm -f /tmp/machinen-install-preflight-$$.txt
if [ "$actual_source_mode" != ${shellQuote(state.sourceIdentity.mode)} ] || [ "$actual_source_size" != ${shellQuote(String(state.sourceIdentity.size))} ] || [ "$actual_source_sha" != ${shellQuote(state.sourceIdentity.sha256)} ]; then
  printf 'PATCH\tinstall-file\trefused\tchanged-source-identity\n'
  exit 2
fi
if [ "$actual_parent_dev" != ${shellQuote(state.destinationParentIdentity.dev)} ] || [ "$actual_parent_mode" != ${shellQuote(state.destinationParentIdentity.mode)} ] || [ "$actual_parent_digest" != ${shellQuote(state.destinationParentIdentity.entriesDigest)} ]; then
  printf 'PATCH\tinstall-file\trefused\tchanged-destination-parent\n'
  exit 2
fi
if ! ${shellQuote(executable)} -m ${shellQuote(state.mode)} ${shellQuote(state.sourcePath)} ${shellQuote(state.destinationPath)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tinstall-file\trefused\tinstall-failed\n'
  exit 2
fi
if [ -L ${shellQuote(state.destinationPath)} ] || [ ! -f ${shellQuote(state.destinationPath)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tinstall-file\trefused\tunsafe-destination-after-install\n'
  exit 2
fi
post_mode=$(stat -c %a ${shellQuote(state.destinationPath)})
post_size=$(stat -c %s ${shellQuote(state.destinationPath)})
post_sha=$(sha256sum ${shellQuote(state.destinationPath)} | awk '{print $1}')
if [ "$post_mode" != ${shellQuote(state.mode)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tinstall-file\trefused\tunexpected-destination-mode\n'
  exit 2
fi
if [ "$post_size" != ${shellQuote(String(state.sourceIdentity.size))} ] || [ "$post_sha" != ${shellQuote(state.sourceIdentity.sha256)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tinstall-file\trefused\tchanged-content-after-install\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-install-completed\n'
printf 'PATCH\tinstall-file\tready\t%s\t%s\t%s\n' ${shellQuote(state.sourcePath)} ${shellQuote(state.destinationPath)} ${shellQuote(state.mode)}
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
    "/usr/bin/install"
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

function normalizeMode(value: string | undefined): string | undefined {
  if (!/^[0-7]{3,4}$/.test(value ?? "")) {
    return undefined;
  }
  return value?.length === 4 && value.startsWith("0") ? value.slice(1) : value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
