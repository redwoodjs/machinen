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
type MoveFindPredicateState = NonNullable<MoveCapture["findPredicateState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveFindPredicateStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["findPredicateState"]> {
  const parsed = moveFindPredicateArgs(node);
  if (!parsed) {
    return undefined;
  }
  const result = await vm.execRaw(
    moveFindPredicatePreflightCommand(parsed.rootPath, parsed.predicate, "find-predicate"),
    { execTimeoutMs: 30_000 },
  );
  const summary = parseFindPredicateSummary(result.stdout);
  return result.exitCode === 0 && summary
    ? {
        rootPath: parsed.rootPath,
        predicate: parsed.predicate,
        treeIdentity: summary,
        options: ["predicate", "-type", "-print"],
        symlinkPolicy: "no-symlinks",
        policy: "bounded-simple-find-predicate",
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetFindPredicateLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.findPredicateState;
  const result = await vm.execRaw(moveFindPredicateLoaderCommand(executable, state), {
    execTimeoutMs: 60_000,
  });
  const patch = moveNamedPatchFromOutput(result, "find-predicate");
  const refusals = moveNamedLoaderRefusals(patch, "target find predicate loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-find-predicate-loader",
    executable,
    argv: [
      executable,
      state?.rootPath ?? "",
      state?.predicate.kind === "mtime" ? "-mtime" : "-size",
      state?.predicate.value ?? "",
      "-type",
      "f",
      "-print",
    ],
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveFindPredicateArgs(
  node: MovePidGraphNode,
): { rootPath: string; predicate: MoveFindPredicateState["predicate"] } | undefined {
  if (moveCommandName(node) !== "find" || node.argv.length !== 7) {
    return undefined;
  }
  const [rootPath, predicateFlag, predicateValue, typeFlag, typeValue, printFlag] =
    node.argv.slice(1);
  const kind =
    predicateFlag === "-mtime" ? "mtime" : predicateFlag === "-size" ? "size" : undefined;
  return rootPath?.startsWith("/") &&
    rootPath !== "/" &&
    safeAbsolutePath(rootPath) &&
    kind &&
    predicateValueSafe(kind, predicateValue) &&
    typeFlag === "-type" &&
    typeValue === "f" &&
    printFlag === "-print"
    ? { rootPath, predicate: { kind, value: predicateValue as string } }
    : undefined;
}

function moveFindPredicatePreflightCommand(
  rootPath: string,
  predicate: MoveFindPredicateState["predicate"],
  patchName: string,
): string {
  const predicateFlag = predicate.kind === "mtime" ? "-mtime" : "-size";
  return `set -eu
root=${shellQuote(rootPath)}
pred_flag=${shellQuote(predicateFlag)}
pred_value=${shellQuote(predicate.value)}
[ -d "$root" ]
[ ! -L "$root" ]
if find "$root" -type l -print -quit | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tsymlink-entry-unsupported\n'
  exit 2
fi
if find "$root" -printf '%P\n' | LC_ALL=C grep -Ev '^([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]*$' | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tunsafe-tree-path\n'
  exit 2
fi
tree_file=/tmp/machinen-find-predicate-tree-$$.txt
: >"$tree_file"
printf '.\tdirectory\t%s\t%s\n' "$(stat -c %f "$root")" "$(stat -c %s "$root")" >>"$tree_file"
find "$root" -mindepth 1 -printf '%P\n' | LC_ALL=C sort | while IFS= read -r rel; do
  path="$root/$rel"
  entry_type=$(find "$path" -maxdepth 0 -printf '%y')
  if [ "$entry_type" = f ]; then
    printf '%s\tfile\t%s\t%s\t%s\t%s\n' "$rel" "$(stat -c %f "$path")" "$(stat -c %s "$path")" "$(stat -c %Y "$path")" "$(sha256sum "$path" | cut -d' ' -f1)" >>"$tree_file"
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
output_file=/tmp/machinen-find-predicate-output-$$.txt
LC_ALL=C /usr/bin/find "$root" "$pred_flag" "$pred_value" -type f -print >"$output_file"
output_digest=$(sha256sum "$output_file" | cut -d' ' -f1)
printf '%s\n%s\n%s\n%s\n%s\n' "$file_count" "$directory_count" "$total_bytes" "$tree_digest" "$output_digest"
rm -f "$tree_file" "$output_file"
`;
}

function moveFindPredicateLoaderCommand(
  executable: string,
  state: MoveFindPredicateState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tfind-predicate\\trefused\\tmissing-find-predicate-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const tree = state.treeIdentity;
  const predicateFlag = state.predicate.kind === "mtime" ? "-mtime" : "-size";
  return `set -eu
log=${shellQuote(log)}
{
${moveFindPredicatePreflightCommand(state.rootPath, state.predicate, "find-predicate")}} >/tmp/machinen-find-predicate-preflight-$$.txt
actual_file_count=$(sed -n '1p' /tmp/machinen-find-predicate-preflight-$$.txt)
actual_directory_count=$(sed -n '2p' /tmp/machinen-find-predicate-preflight-$$.txt)
actual_total_bytes=$(sed -n '3p' /tmp/machinen-find-predicate-preflight-$$.txt)
actual_tree_digest=$(sed -n '4p' /tmp/machinen-find-predicate-preflight-$$.txt)
actual_output_digest=$(sed -n '5p' /tmp/machinen-find-predicate-preflight-$$.txt)
rm -f /tmp/machinen-find-predicate-preflight-$$.txt
if [ "$actual_file_count" != ${shellQuote(String(tree.fileCount))} ] || [ "$actual_directory_count" != ${shellQuote(String(tree.directoryCount))} ] || [ "$actual_total_bytes" != ${shellQuote(String(tree.totalBytes))} ] || [ "$actual_tree_digest" != ${shellQuote(tree.treeDigest)} ] || [ "$actual_output_digest" != ${shellQuote(tree.outputDigest)} ]; then
  printf 'PATCH\tfind-predicate\trefused\tchanged-tree-identity\n'
  exit 2
fi
if ! LC_ALL=C ${shellQuote(executable)} ${shellQuote(state.rootPath)} ${shellQuote(predicateFlag)} ${shellQuote(state.predicate.value)} -type f -print >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tfind-predicate\trefused\tfind-failed\n'
  exit 2
fi
post_digest=$(sha256sum "$log" | cut -d' ' -f1)
if [ "$post_digest" != ${shellQuote(tree.outputDigest)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tfind-predicate\trefused\tunexpected-find-output\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-find-predicate-completed\n'
printf 'PATCH\tfind-predicate\tready\t%s\t%s\t%s\t%s\n' ${shellQuote(state.rootPath)} ${shellQuote(state.predicate.kind)} ${shellQuote(state.predicate.value)} ${shellQuote(tree.treeDigest)}
`;
}

function parseFindPredicateSummary(
  stdout: string,
): MoveFindPredicateState["treeIdentity"] | undefined {
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

function predicateValueSafe(kind: "mtime" | "size", value: string | undefined): boolean {
  return kind === "mtime" ? /^[+-]?\d+$/.test(value ?? "") : /^[+-]?\d+[ckMG]?$/.test(value ?? "");
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
