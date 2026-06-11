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
type MoveMaxdepthFindState = NonNullable<MoveCapture["maxdepthFindState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveMaxdepthFindStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["maxdepthFindState"]> {
  const parsed = moveMaxdepthFindArgs(node);
  if (!parsed) {
    return undefined;
  }
  const result = await vm.execRaw(
    moveMaxdepthFindPreflightCommand(parsed.rootPath, parsed.maxdepth, "maxdepth-find"),
    { execTimeoutMs: 30_000 },
  );
  const summary = parseMaxdepthFindSummary(result.stdout);
  return result.exitCode === 0 && summary
    ? {
        rootPath: parsed.rootPath,
        maxdepth: parsed.maxdepth,
        treeIdentity: summary,
        options: ["-maxdepth", "-type", "-print"],
        symlinkPolicy: "no-symlinks",
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetMaxdepthFindLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.maxdepthFindState;
  const result = await vm.execRaw(moveMaxdepthFindLoaderCommand(executable, state), {
    execTimeoutMs: 60_000,
  });
  const patch = moveNamedPatchFromOutput(result, "maxdepth-find");
  const refusals = moveNamedLoaderRefusals(patch, "target maxdepth find loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-maxdepth-find-loader",
    executable,
    argv: [
      executable,
      state?.rootPath ?? "",
      "-maxdepth",
      String(state?.maxdepth ?? 0),
      "-type",
      "f",
      "-print",
    ],
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveMaxdepthFindArgs(
  node: MovePidGraphNode,
): { rootPath: string; maxdepth: number } | undefined {
  if (moveCommandName(node) !== "find" || node.argv.length !== 7) {
    return undefined;
  }
  const [rootPath, maxdepthFlag, maxdepthText, typeFlag, typeValue, printFlag] = node.argv.slice(1);
  const maxdepth = parsePositiveInteger(maxdepthText);
  return rootPath?.startsWith("/") &&
    rootPath !== "/" &&
    safeAbsolutePath(rootPath) &&
    maxdepthFlag === "-maxdepth" &&
    maxdepth !== undefined &&
    maxdepth <= 10 &&
    typeFlag === "-type" &&
    typeValue === "f" &&
    printFlag === "-print"
    ? { rootPath, maxdepth }
    : undefined;
}

function moveMaxdepthFindPreflightCommand(
  rootPath: string,
  maxdepth: number,
  patchName: string,
): string {
  return `set -eu
root=${shellQuote(rootPath)}
maxdepth=${shellQuote(String(maxdepth))}
[ -d "$root" ]
[ ! -L "$root" ]
if find "$root" -maxdepth "$maxdepth" -type l -print -quit | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tsymlink-entry-unsupported\n'
  exit 2
fi
if find "$root" -maxdepth "$maxdepth" -printf '%P\n' | LC_ALL=C grep -Ev '^([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]*$' | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tunsafe-tree-path\n'
  exit 2
fi
tree_file=/tmp/machinen-maxdepth-find-tree-$$.txt
: >"$tree_file"
printf '.\tdirectory\t%s\t%s\n' "$(stat -c %f "$root")" "$(stat -c %s "$root")" >>"$tree_file"
find "$root" -maxdepth "$maxdepth" -mindepth 1 -printf '%P\n' | LC_ALL=C sort | while IFS= read -r rel; do
  path="$root/$rel"
  entry_type=$(find "$path" -maxdepth 0 -printf '%y')
  if [ "$entry_type" = f ]; then
    printf '%s\tfile\t%s\t%s\t%s\n' "$rel" "$(stat -c %f "$path")" "$(stat -c %s "$path")" "$(sha256sum "$path" | cut -d' ' -f1)" >>"$tree_file"
  elif [ "$entry_type" = d ]; then
    printf '%s\tdirectory\t%s\t%s\n' "$rel" "$(stat -c %f "$path")" "$(stat -c %s "$path")" >>"$tree_file"
  else
    printf 'PATCH\t${patchName}\trefused\tunsupported-entry-type\n'
    exit 2
  fi
done
file_count=$(awk -F '\t' '$2 == "file" { n++ } END { print n + 0 }' "$tree_file")
directory_count=$(awk -F '\t' '$2 == "directory" { n++ } END { print n + 0 }' "$tree_file")
total_bytes=$(awk -F '\t' '$2 == "file" { n += $4 } END { print n + 0 }' "$tree_file")
tree_digest=$(sha256sum "$tree_file" | cut -d' ' -f1)
output_file=/tmp/machinen-maxdepth-find-output-$$.txt
LC_ALL=C /usr/bin/find "$root" -maxdepth "$maxdepth" -type f -print >"$output_file"
output_digest=$(sha256sum "$output_file" | cut -d' ' -f1)
printf '%s\n%s\n%s\n%s\n%s\n' "$file_count" "$directory_count" "$total_bytes" "$tree_digest" "$output_digest"
rm -f "$tree_file" "$output_file"
`;
}

function moveMaxdepthFindLoaderCommand(
  executable: string,
  state: MoveMaxdepthFindState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tmaxdepth-find\\trefused\\tmissing-maxdepth-find-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const tree = state.treeIdentity;
  return `set -eu
log=${shellQuote(log)}
{
${moveMaxdepthFindPreflightCommand(state.rootPath, state.maxdepth, "maxdepth-find")}} >/tmp/machinen-maxdepth-find-preflight-$$.txt
actual_file_count=$(sed -n '1p' /tmp/machinen-maxdepth-find-preflight-$$.txt)
actual_directory_count=$(sed -n '2p' /tmp/machinen-maxdepth-find-preflight-$$.txt)
actual_total_bytes=$(sed -n '3p' /tmp/machinen-maxdepth-find-preflight-$$.txt)
actual_tree_digest=$(sed -n '4p' /tmp/machinen-maxdepth-find-preflight-$$.txt)
actual_output_digest=$(sed -n '5p' /tmp/machinen-maxdepth-find-preflight-$$.txt)
rm -f /tmp/machinen-maxdepth-find-preflight-$$.txt
if [ "$actual_file_count" != ${shellQuote(String(tree.fileCount))} ] || [ "$actual_directory_count" != ${shellQuote(String(tree.directoryCount))} ] || [ "$actual_total_bytes" != ${shellQuote(String(tree.totalBytes))} ] || [ "$actual_tree_digest" != ${shellQuote(tree.treeDigest)} ] || [ "$actual_output_digest" != ${shellQuote(tree.outputDigest)} ]; then
  printf 'PATCH\tmaxdepth-find\trefused\tchanged-tree-identity\n'
  exit 2
fi
if ! LC_ALL=C ${shellQuote(executable)} ${shellQuote(state.rootPath)} -maxdepth ${shellQuote(String(state.maxdepth))} -type f -print >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tmaxdepth-find\trefused\tfind-failed\n'
  exit 2
fi
post_digest=$(sha256sum "$log" | cut -d' ' -f1)
if [ "$post_digest" != ${shellQuote(tree.outputDigest)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tmaxdepth-find\trefused\tunexpected-find-output\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-maxdepth-find-completed\n'
printf 'PATCH\tmaxdepth-find\tready\t%s\t%s\t%s\n' ${shellQuote(state.rootPath)} ${shellQuote(String(state.maxdepth))} ${shellQuote(tree.treeDigest)}
`;
}

function parseMaxdepthFindSummary(
  stdout: string,
): MoveMaxdepthFindState["treeIdentity"] | undefined {
  const [fileLine, dirLine, bytesLine, treeDigest, outputDigest] = stdout.trim().split("\n");
  const fileCount = Number(fileLine);
  const directoryCount = Number(dirLine);
  const totalBytes = Number(bytesLine);
  return Number.isSafeInteger(fileCount) &&
    fileCount >= 0 &&
    Number.isSafeInteger(directoryCount) &&
    directoryCount > 0 &&
    Number.isSafeInteger(totalBytes) &&
    totalBytes >= 0 &&
    /^[0-9a-f]{64}$/.test(treeDigest ?? "") &&
    /^[0-9a-f]{64}$/.test(outputDigest ?? "")
    ? {
        fileCount,
        directoryCount,
        totalBytes,
        treeDigest: treeDigest as string,
        outputDigest: outputDigest as string,
      }
    : undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
    "/usr/bin/find"
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
