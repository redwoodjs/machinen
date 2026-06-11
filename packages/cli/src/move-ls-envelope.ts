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
type MoveLsState = NonNullable<MoveCapture["lsState"]>;
type MoveLsLongState = NonNullable<MoveCapture["lsLongState"]>;
type MoveLsLongEntry = MoveLsLongState["entries"][number];
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveLsStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["lsState"]> {
  const directoryPath = moveLsDirectory(node, "plain");
  if (!directoryPath) {
    return undefined;
  }
  const result = await vm.execRaw(moveLsPreflightCommand("ls-dir", directoryPath, "short"), {
    execTimeoutMs: 10_000,
  });
  const summary = parseLsSummary(result.stdout);
  return result.exitCode === 0 && summary
    ? {
        directoryPath,
        directoryIdentity: summary,
        ordering: "LC_ALL=C-name-ascending",
        options: ["-1"],
        outputPath: moveStdoutFilePath(resourcePlan),
        policy: "ascii-names-non-recursive-directory-listing",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveLsLongStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["lsLongState"]> {
  const directoryPath = moveLsDirectory(node, "long");
  if (!directoryPath) {
    return undefined;
  }
  const result = await vm.execRaw(moveLsPreflightCommand("ls-long-dir", directoryPath, "long"), {
    execTimeoutMs: 10_000,
  });
  const summary = parseLsSummary(result.stdout);
  const entries = parseLsLongEntries(result.stdout);
  return result.exitCode === 0 && summary && entries.length === summary.entryCount
    ? {
        directoryPath,
        directoryIdentity: summary,
        entries,
        ordering: "LC_ALL=C-name-ascending",
        statPolicy: "regular-or-directory-no-symlinks-owner-group-mapped",
        options: ["-l"],
        outputPath: moveStdoutFilePath(resourcePlan),
        policy: "ascii-names-non-recursive-long-listing",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetLsLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.lsState;
  const result = await vm.execRaw(moveLsLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  return moveLsLoaderResult(result, "target-original-ls-dir-loader", executable, [
    executable,
    "-1",
    state?.directoryPath ?? "",
  ]);
}

export async function runMoveTargetLsLongLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.lsLongState;
  const result = await vm.execRaw(moveLsLongLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  return moveLsLoaderResult(result, "target-original-ls-long-dir-loader", executable, [
    executable,
    "-l",
    state?.directoryPath ?? "",
  ]);
}

function moveLsDirectory(node: MovePidGraphNode, kind: "plain" | "long"): string | undefined {
  const expectedLength = kind === "plain" ? 2 : 3;
  if (moveCommandName(node) !== "ls" || node.argv.length !== expectedLength) {
    return undefined;
  }
  const directoryPath = kind === "plain" ? node.argv[1] : node.argv[2];
  const optionOk = kind === "plain" || node.argv[1] === "-l";
  return optionOk &&
    directoryPath?.startsWith("/") &&
    directoryPath !== "/" &&
    safeAbsolutePath(directoryPath)
    ? directoryPath
    : undefined;
}

function moveLsPreflightCommand(
  patchName: "ls-dir" | "ls-long-dir",
  directoryPath: string,
  kind: "short" | "long",
): string {
  const outputCommand =
    kind === "short" ? 'LC_ALL=C /usr/bin/ls -1 -- "$dir"' : 'LC_ALL=C /usr/bin/ls -l -- "$dir"';
  return `set -eu
dir=${shellQuote(directoryPath)}
[ -d "$dir" ]
[ ! -L "$dir" ]
if find "$dir" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C grep -Ev '^[A-Za-z0-9._-]+$' | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tlocale-sensitive-entry-name\n'
  exit 2
fi
if find "$dir" -mindepth 1 -maxdepth 1 -type l -print -quit | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tsymlink-entry-unsupported\n'
  exit 2
fi
dev=$(stat -c %d "$dir")
inode=$(stat -c %i "$dir")
mode=$(stat -c %f "$dir")
entries_file=/tmp/machinen-ls-entries-$$.txt
: >"$entries_file"
find "$dir" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort | while IFS= read -r name; do
  path="$dir/$name"
  entry_type=$(find "$path" -maxdepth 0 -printf '%y')
  if [ "$entry_type" = f ]; then kind=file; elif [ "$entry_type" = d ]; then kind=directory; else
    printf 'PATCH\t${patchName}\trefused\tunsupported-entry-type\n'
    exit 2
  fi
  uid=$(stat -c %u "$path")
  gid=$(stat -c %g "$path")
  owner=$(getent passwd "$uid" | cut -d: -f1)
  group=$(getent group "$gid" | cut -d: -f1)
  [ -n "$owner" ]
  [ -n "$group" ]
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$kind" "$(stat -c %f "$path")" "$(stat -c %a "$path")" "$(stat -c %s "$path")" "$uid" "$gid" "$owner" "$group" "$(stat -c %Y "$path")" >>"$entries_file"
done
entry_count=$(wc -l <"$entries_file" | tr -d ' ')
entries_digest=$(sha256sum "$entries_file" | cut -d' ' -f1)
output_digest=$(${outputCommand} | sha256sum | cut -d' ' -f1)
printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$dev" "$inode" "$mode" "$entry_count" "$entries_digest" "$output_digest"
if [ ${kind === "long" ? "1" : "0"} -eq 1 ]; then
  cat "$entries_file"
fi
rm -f "$entries_file"
`;
}

function moveLsLoaderCommand(executable: string, state: MoveLsState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tls-dir\\trefused\\tmissing-ls-state\\n'; exit 2";
  }
  return moveLsCommonLoaderCommand({
    executable,
    state,
    patchName: "ls-dir",
    preflightKind: "short",
    argv: `LC_ALL=C ${shellQuote(executable)} -1 -- ${shellQuote(state.directoryPath)}`,
    safeBoundary: "target-ls-dir-completed",
  });
}

function moveLsLongLoaderCommand(executable: string, state: MoveLsLongState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tls-long-dir\\trefused\\tmissing-ls-long-state\\n'; exit 2";
  }
  return moveLsCommonLoaderCommand({
    executable,
    state,
    patchName: "ls-long-dir",
    preflightKind: "long",
    argv: `LC_ALL=C ${shellQuote(executable)} -l -- ${shellQuote(state.directoryPath)}`,
    safeBoundary: "target-ls-long-dir-completed",
  });
}

function moveLsCommonLoaderCommand(options: {
  executable: string;
  state: MoveLsState | MoveLsLongState;
  patchName: "ls-dir" | "ls-long-dir";
  preflightKind: "short" | "long";
  argv: string;
  safeBoundary: string;
}): string {
  const log = "/tmp/machinen-move-loader-$$.log";
  const identity = options.state.directoryIdentity;
  return `set -eu
log=${shellQuote(log)}
{
${moveLsPreflightCommand(options.patchName, options.state.directoryPath, options.preflightKind)}} >/tmp/machinen-ls-preflight-$$.txt
actual_mode=$(sed -n '3p' /tmp/machinen-ls-preflight-$$.txt)
actual_count=$(sed -n '4p' /tmp/machinen-ls-preflight-$$.txt)
actual_entries_digest=$(sed -n '5p' /tmp/machinen-ls-preflight-$$.txt)
actual_output_digest=$(sed -n '6p' /tmp/machinen-ls-preflight-$$.txt)
rm -f /tmp/machinen-ls-preflight-$$.txt
if [ "$actual_mode" != ${shellQuote(identity.mode)} ] || [ "$actual_count" != ${shellQuote(String(identity.entryCount))} ] || [ "$actual_entries_digest" != ${shellQuote(identity.entriesDigest)} ] || [ "$actual_output_digest" != ${shellQuote(identity.outputDigest)} ]; then
  printf 'PATCH\t${options.patchName}\trefused\tchanged-directory-identity\n'
  exit 2
fi
if ! ${options.argv} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\t${options.patchName}\trefused\tls-failed\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\t${options.safeBoundary}\n'
printf 'PATCH\t${options.patchName}\tready\t%s\t%s\t%s\n' ${shellQuote(options.state.directoryPath)} ${shellQuote(String(identity.entryCount))} ${shellQuote(identity.outputDigest)}
`;
}

function parseLsSummary(stdout: string): MoveLsState["directoryIdentity"] | undefined {
  const [dev, inode, mode, countLine, entriesDigest, outputDigest] = stdout.trim().split("\n");
  const entryCount = Number(countLine);
  return dev &&
    inode &&
    /^[0-9a-f]+$/.test(mode ?? "") &&
    Number.isSafeInteger(entryCount) &&
    entryCount >= 0 &&
    /^[0-9a-f]{64}$/.test(entriesDigest ?? "") &&
    /^[0-9a-f]{64}$/.test(outputDigest ?? "")
    ? { dev, inode, mode, entryCount, entriesDigest, outputDigest }
    : undefined;
}

function parseLsLongEntries(stdout: string): MoveLsLongEntry[] {
  return stdout
    .trim()
    .split("\n")
    .slice(6)
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length === 10)
    .map(([name, kind, mode, permissions, size, uid, gid, owner, group, mtimeEpoch]) => {
      const entryKind: MoveLsLongEntry["kind"] = kind === "directory" ? "directory" : "file";
      return {
        name: name as string,
        kind: entryKind,
        mode: mode as string,
        permissions: permissions as string,
        size: Number(size),
        uid: Number(uid),
        gid: Number(gid),
        owner: owner as string,
        group: group as string,
        mtimeEpoch: Number(mtimeEpoch),
      };
    })
    .filter(
      (entry) =>
        safePathComponent(entry.name) &&
        /^[0-9a-f]+$/.test(entry.mode) &&
        /^[0-7]{3,4}$/.test(entry.permissions) &&
        Number.isSafeInteger(entry.size) &&
        Number.isSafeInteger(entry.uid) &&
        Number.isSafeInteger(entry.gid) &&
        Number.isSafeInteger(entry.mtimeEpoch) &&
        entry.owner.length > 0 &&
        entry.group.length > 0,
    );
}

function moveLsLoaderResult(
  result: { stdout: string; stderr: string; exitCode: number },
  strategy: MoveLoadDirectLoader["strategy"],
  executable: string,
  argv: string[],
): MoveLoadDirectLoader {
  const parsed = parseRendezvousOutput(result.stdout);
  const patchName = strategy === "target-original-ls-long-dir-loader" ? "ls-long-dir" : "ls-dir";
  const patch = moveNamedPatchFromOutput(result, patchName);
  const refusals = moveNamedLoaderRefusals(patch, "target ls directory loader failed");
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

function parseRendezvousOutput(stdout: string): { pid?: number; logPath?: string } {
  const rows = stdout.trim().split("\n");
  const pid = Number(rows.find((row) => row.startsWith("LOAD_PID\t"))?.split("\t")[1]);
  const logPath = rows.find((row) => row.startsWith("LOAD_LOG\t"))?.split("\t")[1];
  return { pid: Number.isInteger(pid) && pid > 0 ? pid : undefined, logPath };
}

function moveRendezvousExecutable(descriptor: MoveDescriptor): string {
  return (
    descriptor.resourcePlan?.capture?.executablePackage?.path ??
    descriptor.nodes[0]?.exe ??
    "/usr/bin/ls"
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
