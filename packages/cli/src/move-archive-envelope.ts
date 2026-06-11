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
type MoveZipCreateState = NonNullable<MoveCapture["zipCreateState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveZipCreateStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveCapture["zipCreateState"]> {
  const args = moveZipCreateArgs(node);
  if (!args) {
    return undefined;
  }
  const result = await vm.execRaw(moveZipCreatePreflightCommand(args.archivePath, args.sourceDir), {
    execTimeoutMs: 10_000,
  });
  const [fileCountLine, treeDigestLine] = result.stdout.trim().split("\n");
  const fileCount = Number(fileCountLine);
  return result.exitCode === 0 &&
    Number.isInteger(fileCount) &&
    fileCount > 0 &&
    /^[0-9a-f]{64}$/.test(treeDigestLine ?? "")
    ? {
        archivePath: args.archivePath,
        sourceDir: args.sourceDir,
        sourceIdentity: { fileCount, treeDigest: treeDigestLine as string },
        policy: "safe-relative-regular-no-symlinks-absent-archive",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetZipCreateLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.zipCreateState;
  const argv = [executable, "-r", state?.archivePath ?? "", state?.sourceDir ?? ""];
  const result = await vm.execRaw(moveZipCreateLoaderCommand(executable, state), {
    execTimeoutMs: 300_000,
  });
  const patch = moveNamedPatchFromOutput(result, "zip-create");
  const refusals = moveNamedLoaderRefusals(patch, "target zip create loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-zip-create-loader",
    executable,
    argv,
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveZipCreateArgs(
  node: MovePidGraphNode,
): { archivePath: string; sourceDir: string } | undefined {
  if (moveCommandName(node) !== "zip" || node.argv.length !== 4 || node.argv[1] !== "-r") {
    return undefined;
  }
  const archivePath = node.argv[2];
  const sourceDir = node.argv[3];
  return archivePath?.startsWith("/") && sourceDir?.startsWith("/")
    ? { archivePath, sourceDir }
    : undefined;
}

function moveZipCreatePreflightCommand(archivePath: string, sourceDir: string): string {
  return `set -eu
archive=${shellQuote(archivePath)}
root=${shellQuote(sourceDir)}
parent=$(dirname "$archive")
[ -d "$root" ]
[ ! -L "$root" ]
[ -d "$parent" ]
[ ! -e "$archive" ]
case "$archive" in "$root"|"$root"/*) exit 1 ;; esac
if find "$root" -type l -print -quit | grep -q .; then exit 1; fi
manifest=$(mktemp)
trap 'rm -f "$manifest"' EXIT
(cd "$root" && find . -type f -print | LC_ALL=C sort | sed 's#^./##') | awk '($0 == "" || index($0, "\t") || index($0, "\r")) { bad=1 } { print } END { exit bad ? 1 : 0 }' | while IFS= read -r path; do
  [ -n "$path" ] || continue
  size=$(stat -c %s "$root/$path")
  digest=$(sha256sum "$root/$path" | awk '{print $1}')
  printf '%s\t%s\t%s\n' "$path" "$size" "$digest"
done >"$manifest"
[ -s "$manifest" ]
wc -l <"$manifest"
sha256sum "$manifest" | awk '{print $1}'
`;
}

function moveZipCreateLoaderCommand(
  executable: string,
  state: MoveZipCreateState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tzip-create\\trefused\\tmissing-zip-create-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveZipCreatePreflightCommand(state.archivePath, state.sourceDir)}} > /tmp/machinen-zip-preflight-$$.txt
actual_count=$(sed -n '1p' /tmp/machinen-zip-preflight-$$.txt)
actual_digest=$(sed -n '2p' /tmp/machinen-zip-preflight-$$.txt)
rm -f /tmp/machinen-zip-preflight-$$.txt
if [ "$actual_count" != ${shellQuote(String(state.sourceIdentity.fileCount))} ] || [ "$actual_digest" != ${shellQuote(state.sourceIdentity.treeDigest)} ]; then
  printf 'PATCH\tzip-create\trefused\tchanged-source-identity\n'
  exit 2
fi
if ! ${shellQuote(executable)} -r ${shellQuote(state.archivePath)} ${shellQuote(state.sourceDir)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tzip-create\trefused\tzip-failed\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-zip-create-completed\n'
printf 'PATCH\tzip-create\tready\t%s\t%s\n' ${shellQuote(state.archivePath)} ${shellQuote(state.sourceDir)}
`;
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
    "/usr/bin/zip"
  );
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.argv[0] ?? node.command ?? node.exe);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
