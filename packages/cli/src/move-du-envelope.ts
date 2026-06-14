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
type MoveDuState = NonNullable<MoveCapture["duState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveDuStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["duState"]> {
  const directoryPath = moveDuDirectory(node);
  if (!directoryPath) {
    return undefined;
  }
  const result = await vm.execRaw(moveDuPreflightCommand(directoryPath, "du-sb-dir"), {
    execTimeoutMs: 30_000,
  });
  const summary = parseDuSummary(result.stdout);
  return result.exitCode === 0 && summary
    ? {
        directoryPath,
        rootDevice: summary.rootDevice,
        treeIdentity: {
          entryCount: summary.entryCount,
          fileCount: summary.fileCount,
          directoryCount: summary.directoryCount,
          totalBytes: summary.totalBytes,
          treeDigest: summary.treeDigest,
          outputDigest: summary.outputDigest,
        },
        options: ["-s", "-b"],
        symlinkPolicy: "no-symlinks",
        mountPolicy: "single-device-no-mount-crossing",
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetDuLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.duState;
  const result = await vm.execRaw(moveDuLoaderCommand(executable, state), {
    execTimeoutMs: 60_000,
  });
  const patch = moveNamedPatchFromOutput(result, "du-sb-dir");
  const refusals = moveNamedLoaderRefusals(patch, "target du directory loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-du-sb-dir-loader",
    executable,
    argv: [executable, "-s", "-b", state?.directoryPath ?? ""],
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveDuDirectory(node: MovePidGraphNode): string | undefined {
  if (moveCommandName(node) !== "du" || node.argv.length !== 3) {
    return undefined;
  }
  const option = node.argv[1];
  const directoryPath = node.argv[2];
  return option === "-sb" &&
    directoryPath?.startsWith("/") &&
    directoryPath !== "/" &&
    safeAbsolutePath(directoryPath)
    ? directoryPath
    : undefined;
}

function moveDuPreflightCommand(directoryPath: string, patchName: string): string {
  return `set -eu
dir=${shellQuote(directoryPath)}
[ -d "$dir" ]
[ ! -L "$dir" ]
root_dev=$(stat -c %d "$dir")
if find "$dir" -xdev -type l -print -quit | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tsymlink-entry-unsupported\n'
  exit 2
fi
if find "$dir" -mindepth 1 -printf '%D\n' | awk -v root="$root_dev" '$1 != root { found=1 } END { exit found ? 0 : 1 }'; then
  printf 'PATCH\t${patchName}\trefused\tmount-crossing-unsupported\n'
  exit 2
fi
if find "$dir" -xdev -printf '%P\n' | LC_ALL=C grep -Ev '^([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]*$' | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tunsafe-tree-path\n'
  exit 2
fi
entries_file=/tmp/machinen-du-tree-$$.txt
: >"$entries_file"
printf '.\tdirectory\t%s\t%s\n' "$(stat -c %f "$dir")" "$(stat -c %s "$dir")" >>"$entries_file"
find "$dir" -xdev -mindepth 1 -printf '%P\n' | LC_ALL=C sort | while IFS= read -r rel; do
  path="$dir/$rel"
  entry_type=$(find "$path" -maxdepth 0 -printf '%y')
  if [ "$entry_type" = f ]; then
    digest=$(sha256sum "$path" | cut -d' ' -f1)
    printf '%s\tfile\t%s\t%s\t%s\n' "$rel" "$(stat -c %f "$path")" "$(stat -c %s "$path")" "$digest" >>"$entries_file"
  elif [ "$entry_type" = d ]; then
    printf '%s\tdirectory\t%s\t%s\n' "$rel" "$(stat -c %f "$path")" "$(stat -c %s "$path")" >>"$entries_file"
  else
    printf 'PATCH\t${patchName}\trefused\tunsupported-entry-type\n'
    exit 2
  fi
done
entry_count=$(wc -l <"$entries_file" | tr -d ' ')
file_count=$(awk -F '\t' '$2 == "file" { n++ } END { print n + 0 }' "$entries_file")
directory_count=$(awk -F '\t' '$2 == "directory" { n++ } END { print n + 0 }' "$entries_file")
tree_digest=$(sha256sum "$entries_file" | cut -d' ' -f1)
du_output=$(/usr/bin/du -sb -- "$dir")
total_bytes=$(printf '%s\n' "$du_output" | cut -f1)
output_digest=$(printf '%s\n' "$du_output" | sha256sum | cut -d' ' -f1)
printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$root_dev" "$entry_count" "$file_count" "$directory_count" "$total_bytes" "$tree_digest" "$output_digest"
rm -f "$entries_file"
`;
}

function moveDuLoaderCommand(executable: string, state: MoveDuState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tdu-sb-dir\\trefused\\tmissing-du-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const identity = state.treeIdentity;
  return `set -eu
log=${shellQuote(log)}
{
${moveDuPreflightCommand(state.directoryPath, "du-sb-dir")}} >/tmp/machinen-du-preflight-$$.txt
actual_entry_count=$(sed -n '2p' /tmp/machinen-du-preflight-$$.txt)
actual_file_count=$(sed -n '3p' /tmp/machinen-du-preflight-$$.txt)
actual_directory_count=$(sed -n '4p' /tmp/machinen-du-preflight-$$.txt)
actual_total_bytes=$(sed -n '5p' /tmp/machinen-du-preflight-$$.txt)
actual_tree_digest=$(sed -n '6p' /tmp/machinen-du-preflight-$$.txt)
actual_output_digest=$(sed -n '7p' /tmp/machinen-du-preflight-$$.txt)
rm -f /tmp/machinen-du-preflight-$$.txt
if [ "$actual_entry_count" != ${shellQuote(String(identity.entryCount))} ] || [ "$actual_file_count" != ${shellQuote(String(identity.fileCount))} ] || [ "$actual_directory_count" != ${shellQuote(String(identity.directoryCount))} ] || [ "$actual_total_bytes" != ${shellQuote(String(identity.totalBytes))} ] || [ "$actual_tree_digest" != ${shellQuote(identity.treeDigest)} ] || [ "$actual_output_digest" != ${shellQuote(identity.outputDigest)} ]; then
  printf 'PATCH\tdu-sb-dir\trefused\tchanged-tree-identity\n'
  exit 2
fi
if ! ${shellQuote(executable)} -sb -- ${shellQuote(state.directoryPath)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tdu-sb-dir\trefused\tdu-failed\n'
  exit 2
fi
post_digest=$(sha256sum "$log" | cut -d' ' -f1)
post_total=$(cut -f1 "$log")
if [ "$post_digest" != ${shellQuote(identity.outputDigest)} ] || [ "$post_total" != ${shellQuote(String(identity.totalBytes))} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tdu-sb-dir\trefused\tunexpected-du-output\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-du-sb-dir-completed\n'
printf 'PATCH\tdu-sb-dir\tready\t%s\t%s\t%s\n' ${shellQuote(state.directoryPath)} ${shellQuote(String(identity.totalBytes))} ${shellQuote(identity.treeDigest)}
`;
}

type DuSummary = MoveDuState["treeIdentity"] & { rootDevice: string };

function parseDuSummary(stdout: string): DuSummary | undefined {
  const [rootDevice, entryLine, fileLine, dirLine, bytesLine, treeDigest, outputDigest] = stdout
    .trim()
    .split("\n");
  const entryCount = Number(entryLine);
  const fileCount = Number(fileLine);
  const directoryCount = Number(dirLine);
  const totalBytes = Number(bytesLine);
  return rootDevice &&
    Number.isSafeInteger(entryCount) &&
    entryCount > 0 &&
    Number.isSafeInteger(fileCount) &&
    fileCount >= 0 &&
    Number.isSafeInteger(directoryCount) &&
    directoryCount > 0 &&
    Number.isSafeInteger(totalBytes) &&
    totalBytes >= 0 &&
    /^[0-9a-f]{64}$/.test(treeDigest ?? "") &&
    /^[0-9a-f]{64}$/.test(outputDigest ?? "")
    ? {
        rootDevice,
        entryCount,
        fileCount,
        directoryCount,
        totalBytes,
        treeDigest: treeDigest as string,
        outputDigest: outputDigest as string,
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
    "/usr/bin/du"
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
