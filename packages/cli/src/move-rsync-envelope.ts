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
type MoveRsyncDaemonState = NonNullable<MoveCapture["rsyncDaemonState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readRsyncDaemonState(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["rsyncDaemonState"]> {
  const configPath = parseRsyncDaemonConfigPath(node);
  if (!configPath || resourcePlan.resources.filter((r) => r.kind === "socket").length < 1) {
    return undefined;
  }
  const result = await vm.execRaw(rsyncDaemonPreflightCommand(configPath, "rsync-daemon"), {
    execTimeoutMs: 30_000,
  });
  const parsed = parseRsyncDaemonPreflight(result.stdout);
  return result.exitCode === 0 && parsed
    ? {
        configPath,
        configSha256: parsed.configSha256,
        moduleName: parsed.moduleName,
        root: parsed.root,
        port: parsed.port,
        policy: "read-only-module-no-auth-hooks",
        listenerState: "idle-single-listener-no-active-clients",
        directoryIdentity: parsed.directoryIdentity,
        binaryPolicy: "proof-provisioned-target-native-rsync",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runRsyncDaemon(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = "/usr/bin/rsync";
  const state = descriptor.resourcePlan?.capture?.rsyncDaemonState;
  const result = await vm.execRaw(moveRsyncDaemonLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "rsync-daemon");
  const refusals = moveNamedLoaderRefusals(patch, "target rsync daemon loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-native-rsync-daemon-loader",
    executable,
    argv: state
      ? [executable, "--daemon", "--no-detach", "--config", state.configPath]
      : [executable],
    targetPid: parseLoadPid(result.stdout),
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function parseRsyncDaemonConfigPath(node: MovePidGraphNode): string | undefined {
  if (moveCommandName(node) !== "rsync" || node.argv.length !== 5) {
    return undefined;
  }
  const configPath = node.argv[4];
  return node.argv[1] === "--daemon" &&
    node.argv[2] === "--no-detach" &&
    node.argv[3] === "--config" &&
    safePath(configPath)
    ? configPath
    : undefined;
}

function rsyncDaemonPreflightCommand(configPath: string, patchName: string): string {
  return `set -eu
tcp_state_for_port() { awk -v p="$(printf '%04X' "$1")" -v s="$2" '$4 == s { split($2, a, ":"); if (toupper(a[2]) == p) found=1 } END { exit found ? 0 : 1 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null; }
config=${shellQuote(configPath)}
[ -f "$config" ] && [ ! -L "$config" ] || { printf 'PATCH\t${patchName}\trefused\tmissing-config\n'; exit 2; }
if grep -Eiq '^[[:space:]]*(auth users|secrets file|hosts allow|hosts deny|pre-xfer exec|post-xfer exec|munge symlinks|use chroot)[[:space:]]*=' "$config"; then
  printf 'PATCH\t${patchName}\trefused\tauth-or-hook-config\n'
  exit 2
fi
if grep -Eiq '^[[:space:]]*(read only[[:space:]]*=[[:space:]]*(false|no|0)|write only[[:space:]]*=)' "$config"; then
  printf 'PATCH\t${patchName}\trefused\twrite-module\n'
  exit 2
fi
port=$(sed -nE 's/^[[:space:]]*port[[:space:]]*=[[:space:]]*([0-9]+)[[:space:]]*$/\\1/p' "$config")
module=$(sed -nE 's/^\\[([A-Za-z0-9._-]+)\\][[:space:]]*$/\\1/p' "$config")
root=$(sed -nE 's|^[[:space:]]*path[[:space:]]*=[[:space:]]*([^[:space:]]+)[[:space:]]*$|\\1|p' "$config")
readonly=$(sed -nE 's/^[[:space:]]*read only[[:space:]]*=[[:space:]]*(true|yes|1)[[:space:]]*$/\\1/ip' "$config")
[ "$(printf '%s\n' "$port" | sed '/^$/d' | wc -l)" = 1 ] || { printf 'PATCH\t${patchName}\trefused\tport-contract\n'; exit 2; }
[ "$(printf '%s\n' "$module" | sed '/^$/d' | wc -l)" = 1 ] || { printf 'PATCH\t${patchName}\trefused\tmodule-contract\n'; exit 2; }
[ "$(printf '%s\n' "$root" | sed '/^$/d' | wc -l)" = 1 ] || { printf 'PATCH\t${patchName}\trefused\troot-contract\n'; exit 2; }
[ -n "$readonly" ] || { printf 'PATCH\t${patchName}\trefused\tmissing-readonly\n'; exit 2; }
case "$port" in ''|*[!0-9]*) printf 'PATCH\t${patchName}\trefused\tbad-port\n'; exit 2 ;; esac
[ "$port" -gt 0 ] && [ "$port" -lt 65536 ] || { printf 'PATCH\t${patchName}\trefused\tbad-port\n'; exit 2; }
printf '%s\n%s\n' "$module" "$root" | grep -Eq '^[A-Za-z0-9._/-]+$' || { printf 'PATCH\t${patchName}\trefused\tunsafe-config\n'; exit 2; }
case "$root" in /*) ;; *) printf 'PATCH\t${patchName}\trefused\tunsafe-root\n'; exit 2 ;; esac
if tcp_state_for_port "$port" 01; then
  printf 'PATCH\t${patchName}\trefused\tactive-client\n'
  exit 2
fi
[ -d "$root" ] && [ ! -L "$root" ] || { printf 'PATCH\t${patchName}\trefused\tmissing-root\n'; exit 2; }
if find "$root" -type l -print -quit | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tsymlink-entry-unsupported\n'
  exit 2
fi
if find "$root" -printf '%P\n' | LC_ALL=C grep -Ev '^([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]*$' | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tunsafe-directory-path\n'
  exit 2
fi
tree_file=/tmp/machinen-rsync-directory-$$.txt
: >"$tree_file"
printf '.\tdirectory\t%s\t%s\n' "$(stat -c %f "$root")" "$(stat -c %s "$root")" >>"$tree_file"
find "$root" -mindepth 1 -printf '%P\n' | LC_ALL=C sort | while IFS= read -r rel; do
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
config_sha=$(sha256sum "$config" | cut -d' ' -f1)
file_count=$(awk -F '\t' '$2 == "file" { n++ } END { print n + 0 }' "$tree_file")
directory_count=$(awk -F '\t' '$2 == "directory" { n++ } END { print n + 0 }' "$tree_file")
total_bytes=$(awk -F '\t' '$2 == "file" { n += $4 } END { print n + 0 }' "$tree_file")
tree_digest=$(sha256sum "$tree_file" | cut -d' ' -f1)
rm -f "$tree_file"
printf 'RSYNC_DAEMON_OK\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$port" "$module" "$root" "$config_sha" "$file_count" "$directory_count" "$total_bytes" "$tree_digest"
`;
}

function moveRsyncDaemonLoaderCommand(
  executable: string,
  state: MoveRsyncDaemonState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\trsync-daemon\\trefused\\tmissing-rsync-daemon-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-rsync-loader-$$.log";
  const preflight = rsyncDaemonPreflightCommand(state.configPath, "rsync-daemon");
  return `set -eu
log=${shellQuote(log)}
if [ ! -x ${shellQuote(executable)} ]; then
  printf 'PATCH\trsync-daemon\trefused\tmissing-rsync\n'
  exit 2
fi
tcp_state_for_port() { awk -v p="$(printf '%04X' "$1")" -v s="$2" '$4 == s { split($2, a, ":"); if (toupper(a[2]) == p) found=1 } END { exit found ? 0 : 1 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null; }
if tcp_state_for_port ${state.port} 0A; then
  printf 'PATCH\trsync-daemon\trefused\tport-in-use\n'
  exit 2
fi
preflight_line=$(sh -c ${shellQuote(preflight)} | grep '^RSYNC_DAEMON_OK')
IFS='\t' read -r _ port module root config_sha file_count directory_count total_bytes tree_digest <<EOF
$preflight_line
EOF
[ "$port" = ${shellQuote(String(state.port))} ] && [ "$module" = ${shellQuote(state.moduleName)} ] && [ "$root" = ${shellQuote(state.root)} ] && [ "$config_sha" = ${shellQuote(state.configSha256)} ] || { printf 'PATCH\trsync-daemon\trefused\tchanged-config\n'; exit 2; }
[ "$file_count" = ${shellQuote(String(state.directoryIdentity.fileCount))} ] && [ "$directory_count" = ${shellQuote(String(state.directoryIdentity.directoryCount))} ] && [ "$total_bytes" = ${shellQuote(String(state.directoryIdentity.totalBytes))} ] && [ "$tree_digest" = ${shellQuote(state.directoryIdentity.treeDigest)} ] || { printf 'PATCH\trsync-daemon\trefused\tchanged-root-identity\n'; exit 2; }
${shellQuote(executable)} --daemon --no-detach --config ${shellQuote(state.configPath)} >"$log" 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\trsync-daemon\trefused\tstart-failed\n'
    exit 2
  fi
  if tcp_state_for_port ${state.port} 0A; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  kill -TERM "$pid" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\trsync-daemon\trefused\tnot-listening\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\trsync-daemon\ttarget-rsync-readonly-started\n'
printf 'PATCH\trsync-daemon\tready\t%s\t%s\n' ${shellQuote(String(state.port))} ${shellQuote(state.moduleName)}
`;
}

interface RsyncParsedState {
  port: number;
  moduleName: string;
  root: string;
  configSha256: string;
  directoryIdentity: MoveRsyncDaemonState["directoryIdentity"];
}

function parseRsyncDaemonPreflight(stdout: string): RsyncParsedState | undefined {
  const row = stdout
    .trim()
    .split("\n")
    .find((line) => line.startsWith("RSYNC_DAEMON_OK\t"));
  const [, portText, moduleName, root, configSha256, fileText, dirText, bytesText, treeDigest] =
    row?.split("\t") ?? [];
  const port = Number(portText);
  const fileCount = Number(fileText);
  const directoryCount = Number(dirText);
  const totalBytes = Number(bytesText);
  return Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
    safeName(moduleName) &&
    safePath(root) &&
    /^[0-9a-f]{64}$/.test(configSha256 ?? "") &&
    Number.isSafeInteger(fileCount) &&
    fileCount >= 0 &&
    Number.isSafeInteger(directoryCount) &&
    directoryCount > 0 &&
    Number.isSafeInteger(totalBytes) &&
    totalBytes >= 0 &&
    /^[0-9a-f]{64}$/.test(treeDigest ?? "")
    ? {
        port,
        moduleName: moduleName as string,
        root: root as string,
        configSha256: configSha256 as string,
        directoryIdentity: {
          fileCount,
          directoryCount,
          totalBytes,
          treeDigest: treeDigest as string,
        },
      }
    : undefined;
}

function safePath(path: string | undefined): path is string {
  return !!path && path.startsWith("/") && path.split("/").filter(Boolean).every(safePathComponent);
}
function safeName(value: string | undefined): value is string {
  return !!value && /^[A-Za-z0-9._-]+$/.test(value);
}
function safePathComponent(component: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(component) && component !== "." && component !== "..";
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
function parseLoadPid(stdout: string): number | undefined {
  const pid = Number(
    stdout
      .split("\n")
      .find((row) => row.startsWith("LOAD_PID\t"))
      ?.split("\t")[1],
  );
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}
function parseLogPath(stdout: string): string | undefined {
  return stdout
    .trim()
    .split("\n")
    .find((row) => row.startsWith("LOAD_LOG\t"))
    ?.split("\t")[1];
}
function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.argv[0] ?? node.command ?? node.exe);
}
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
