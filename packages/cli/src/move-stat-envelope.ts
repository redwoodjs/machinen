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
type MoveStatState = NonNullable<MoveCapture["statState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveStatStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["statState"]> {
  const path = moveStatPath(node);
  if (!path) {
    return undefined;
  }
  const result = await vm.execRaw(moveStatPreflightCommand(path, "stat-file"), {
    execTimeoutMs: 10_000,
  });
  const identity = parseStatIdentity(result.stdout);
  return result.exitCode === 0 && identity
    ? {
        path,
        format: "default",
        options: [],
        fileIdentity: identity,
        outputPath: moveStdoutFilePath(resourcePlan),
        symlinkPolicy: "no-symlinks",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetStatLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.statState;
  const result = await vm.execRaw(moveStatLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "stat-file");
  const refusals = moveNamedLoaderRefusals(patch, "target stat file loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-stat-file-loader",
    executable,
    argv: [executable, state?.path ?? ""],
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveStatPath(node: MovePidGraphNode): string | undefined {
  if (moveCommandName(node) !== "stat" || node.argv.length !== 2) {
    return undefined;
  }
  const path = node.argv[1];
  return path?.startsWith("/") && path !== "/" && safeAbsolutePath(path) ? path : undefined;
}

function moveStatPreflightCommand(path: string, patchName: string): string {
  return `set -eu
path=${shellQuote(path)}
[ -f "$path" ]
[ ! -L "$path" ]
file_type=$(stat -c %F "$path")
if [ "$file_type" != 'regular file' ]; then
  printf 'PATCH\t${patchName}\trefused\tunsupported-file-type\n'
  exit 2
fi
mode=$(stat -c %f "$path")
permissions=$(stat -c %a "$path")
size=$(stat -c %s "$path")
uid=$(stat -c %u "$path")
gid=$(stat -c %g "$path")
mtime=$(stat -c %Y "$path")
sha=$(sha256sum "$path" | cut -d' ' -f1)
printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$file_type" "$mode" "$permissions" "$size" "$uid" "$gid" "$mtime" "$sha"
`;
}

function moveStatLoaderCommand(executable: string, state: MoveStatState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tstat-file\\trefused\\tmissing-stat-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const id = state.fileIdentity;
  return `set -eu
log=${shellQuote(log)}
{
${moveStatPreflightCommand(state.path, "stat-file")}} >/tmp/machinen-stat-preflight-$$.txt
actual_type=$(sed -n '1p' /tmp/machinen-stat-preflight-$$.txt)
actual_mode=$(sed -n '2p' /tmp/machinen-stat-preflight-$$.txt)
actual_permissions=$(sed -n '3p' /tmp/machinen-stat-preflight-$$.txt)
actual_size=$(sed -n '4p' /tmp/machinen-stat-preflight-$$.txt)
actual_uid=$(sed -n '5p' /tmp/machinen-stat-preflight-$$.txt)
actual_gid=$(sed -n '6p' /tmp/machinen-stat-preflight-$$.txt)
actual_mtime=$(sed -n '7p' /tmp/machinen-stat-preflight-$$.txt)
actual_sha=$(sed -n '8p' /tmp/machinen-stat-preflight-$$.txt)
rm -f /tmp/machinen-stat-preflight-$$.txt
if [ "$actual_type" != ${shellQuote(id.fileType)} ] || [ "$actual_mode" != ${shellQuote(id.mode)} ] || [ "$actual_permissions" != ${shellQuote(id.permissions)} ] || [ "$actual_size" != ${shellQuote(String(id.size))} ] || [ "$actual_uid" != ${shellQuote(String(id.uid))} ] || [ "$actual_gid" != ${shellQuote(String(id.gid))} ] || [ "$actual_mtime" != ${shellQuote(String(id.mtimeEpoch))} ] || [ "$actual_sha" != ${shellQuote(id.sha256)} ]; then
  printf 'PATCH\tstat-file\trefused\tchanged-file-identity\n'
  exit 2
fi
if ! ${shellQuote(executable)} -- ${shellQuote(state.path)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tstat-file\trefused\tstat-failed\n'
  exit 2
fi
post_type=$(stat -c %F ${shellQuote(state.path)})
post_size=$(stat -c %s ${shellQuote(state.path)})
post_sha=$(sha256sum ${shellQuote(state.path)} | cut -d' ' -f1)
if [ "$post_type" != ${shellQuote(id.fileType)} ] || [ "$post_size" != ${shellQuote(String(id.size))} ] || [ "$post_sha" != ${shellQuote(id.sha256)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tstat-file\trefused\tunexpected-stat-fields\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-stat-file-completed\n'
printf 'PATCH\tstat-file\tready\t%s\t%s\t%s\n' ${shellQuote(state.path)} ${shellQuote(String(id.size))} ${shellQuote(id.sha256)}
`;
}

function parseStatIdentity(stdout: string): MoveStatState["fileIdentity"] | undefined {
  const [fileType, mode, permissions, sizeLine, uidLine, gidLine, mtimeLine, sha256] = stdout
    .trim()
    .split("\n");
  const size = Number(sizeLine);
  const uid = Number(uidLine);
  const gid = Number(gidLine);
  const mtimeEpoch = Number(mtimeLine);
  return fileType === "regular file" &&
    /^[0-9a-f]+$/.test(mode ?? "") &&
    /^[0-7]{3,4}$/.test(permissions ?? "") &&
    Number.isSafeInteger(size) &&
    size >= 0 &&
    Number.isSafeInteger(uid) &&
    uid >= 0 &&
    Number.isSafeInteger(gid) &&
    gid >= 0 &&
    Number.isSafeInteger(mtimeEpoch) &&
    /^[0-9a-f]{64}$/.test(sha256 ?? "")
    ? {
        fileType,
        mode: mode as string,
        permissions: permissions as string,
        size,
        uid,
        gid,
        mtimeEpoch,
        sha256: sha256 as string,
      }
    : undefined;
}

function moveStdoutFilePath(resourcePlan: MoveResourcePlan): string | undefined {
  const stdout = resourcePlan.resources.find((resource) => resource.fd === 1);
  return stdout?.kind === "file" && typeof stdout.path === "string" ? stdout.path : undefined;
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
    "/usr/bin/stat"
  );
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.argv[0] ?? node.command ?? node.exe);
}

function safeAbsolutePath(path: string): boolean {
  return path.split("/").filter(Boolean).every(safePathComponent);
}

function safePathComponent(component: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(component) && component !== "." && component !== "..";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
