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
type MoveNginxStaticState = NonNullable<MoveCapture["nginxStaticState"]>;
type MoveCaddyStaticState = NonNullable<MoveCapture["caddyStaticState"]>;
type MoveRubyHttpState = NonNullable<MoveCapture["rubyHttpState"]>;
type MovePhpStaticState = NonNullable<MoveCapture["phpStaticState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveNginxStaticStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["nginxStaticState"]> {
  const configPath = parseNginxConfigPath(node);
  if (!configPath || resourcePlan.resources.filter((r) => r.kind === "socket").length < 1) {
    return undefined;
  }
  const result = await vm.execRaw(nginxStaticPreflightCommand(configPath, "nginx-static"), {
    execTimeoutMs: 30_000,
  });
  const parsed = parseNginxStaticPreflight(result.stdout);
  return result.exitCode === 0 && parsed
    ? {
        configPath,
        configSha256: parsed.configSha256,
        root: parsed.root,
        port: parsed.port,
        configContract: "nginx-static-root-local-listen-try-files-404",
        listenerState: "idle-single-listener",
        directoryIdentity: parsed.directoryIdentity,
        binaryPolicy: "proof-provisioned-target-native-nginx",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetNginxStaticLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = "/usr/sbin/nginx";
  const state = descriptor.resourcePlan?.capture?.nginxStaticState;
  const result = await vm.execRaw(moveNginxStaticLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "nginx-static");
  const refusals = moveNamedLoaderRefusals(patch, "target nginx static loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-native-nginx-static-loader",
    executable,
    argv: state ? [executable, "-c", state.configPath, "-g", "daemon off;"] : [executable],
    targetPid: parseLoadPid(result.stdout),
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function parseNginxConfigPath(node: MovePidGraphNode): string | undefined {
  if (node.argv.length === 1) {
    const rewritten = (node.argv[0] ?? node.command).match(
      /^nginx: master process \/usr\/sbin\/nginx -c ([^ ]+) -g daemon off;\s*$/,
    );
    return safePath(rewritten?.[1]) ? rewritten?.[1] : undefined;
  }
  if (moveCommandName(node) !== "nginx") {
    return undefined;
  }
  const cIndex = node.argv.indexOf("-c");
  const gIndex = node.argv.indexOf("-g");
  const configPath = node.argv[cIndex + 1];
  return cIndex === 1 &&
    gIndex === 3 &&
    node.argv[gIndex + 1] === "daemon off;" &&
    node.argv.length === 5 &&
    safePath(configPath)
    ? configPath
    : undefined;
}

function nginxStaticPreflightCommand(configPath: string, patchName: string): string {
  return `set -eu
tcp_state_for_port() { awk -v p="$(printf '%04X' "$1")" -v s="$2" '$4 == s { split($2, a, ":"); if (toupper(a[2]) == p) found=1 } END { exit found ? 0 : 1 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null; }
config=${shellQuote(configPath)}
[ -f "$config" ] && [ ! -L "$config" ] || { printf 'PATCH\t${patchName}\trefused\tmissing-config\n'; exit 2; }
if grep -Eiq '(^|[[:space:];])(proxy_pass|fastcgi_pass|uwsgi_pass|scgi_pass|ssl_certificate|ssl_certificate_key|auth_request|perl|lua_|js_content|grpc_pass)[[:space:];]' "$config"; then
  printf 'PATCH\t${patchName}\trefused\tdynamic-or-proxy-config\n'
  exit 2
fi
listen=$(sed -nE 's/^[[:space:]]*listen[[:space:]]+127\\.0\\.0\\.1:([0-9]+);[[:space:]]*$/\\1/p' "$config")
root=$(sed -nE 's|^[[:space:]]*root[[:space:]]+([^ ;]+);[[:space:]]*$|\\1|p' "$config")
[ "$(printf '%s\n' "$listen" | sed '/^$/d' | wc -l)" = 1 ] || { printf 'PATCH\t${patchName}\trefused\tlisten-contract\n'; exit 2; }
[ "$(printf '%s\n' "$root" | sed '/^$/d' | wc -l)" = 1 ] || { printf 'PATCH\t${patchName}\trefused\troot-contract\n'; exit 2; }
case "$root" in /*) ;; *) printf 'PATCH\t${patchName}\trefused\tunsafe-root\n'; exit 2 ;; esac
printf '%s\n' "$root" | grep -Eq '^/([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+$' || { printf 'PATCH\t${patchName}\trefused\tunsafe-root\n'; exit 2; }
grep -Eq '^[[:space:]]*location[[:space:]]+/[[:space:]]*\\{[[:space:]]*try_files[[:space:]]+\\$uri[[:space:]]+=404;[[:space:]]*\\}[[:space:]]*$' "$config" || { printf 'PATCH\t${patchName}\trefused\tmissing-static-location\n'; exit 2; }
port=$listen
case "$port" in ''|*[!0-9]*) printf 'PATCH\t${patchName}\trefused\tbad-port\n'; exit 2 ;; esac
[ "$port" -gt 0 ] && [ "$port" -lt 65536 ] || { printf 'PATCH\t${patchName}\trefused\tbad-port\n'; exit 2; }
if tcp_state_for_port "$port" 01; then
  printf 'PATCH\t${patchName}\trefused\tactive-connection\n'
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
tree_file=/tmp/machinen-nginx-directory-$$.txt
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
printf 'NGINX_STATIC_OK\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$port" "$root" "$config_sha" "$file_count" "$directory_count" "$total_bytes" "$tree_digest"
`;
}

function moveNginxStaticLoaderCommand(
  executable: string,
  state: MoveNginxStaticState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tnginx-static\\trefused\\tmissing-nginx-static-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-nginx-loader-$$.log";
  const preflight = nginxStaticPreflightCommand(state.configPath, "nginx-static");
  return `set -eu
log=${shellQuote(log)}
if [ ! -x ${shellQuote(executable)} ]; then
  printf 'PATCH\tnginx-static\trefused\tmissing-nginx\n'
  exit 2
fi
tcp_state_for_port() { awk -v p="$(printf '%04X' "$1")" -v s="$2" '$4 == s { split($2, a, ":"); if (toupper(a[2]) == p) found=1 } END { exit found ? 0 : 1 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null; }
if tcp_state_for_port ${state.port} 0A; then
  printf 'PATCH\tnginx-static\trefused\tport-in-use\n'
  exit 2
fi
${preflight}
actual_sha=$(sha256sum ${shellQuote(state.configPath)} | cut -d' ' -f1)
[ "$actual_sha" = ${shellQuote(state.configSha256)} ] || { printf 'PATCH\tnginx-static\trefused\tchanged-config-digest\n'; exit 2; }
preflight_line=$(sh -c ${shellQuote(`tcp_state_for_port() { awk -v p="$(printf '%04X' "$1")" -v s="$2" '$4 == s { split($2, a, ":"); if (toupper(a[2]) == p) found=1 } END { exit found ? 0 : 1 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null; }
${preflight}`)} | grep '^NGINX_STATIC_OK')
IFS='\t' read -r _ port root config_sha file_count directory_count total_bytes tree_digest <<EOF
$preflight_line
EOF
[ "$port" = ${shellQuote(String(state.port))} ] && [ "$root" = ${shellQuote(state.root)} ] && [ "$config_sha" = ${shellQuote(state.configSha256)} ] || { printf 'PATCH\tnginx-static\trefused\tchanged-config\n'; exit 2; }
[ "$file_count" = ${shellQuote(String(state.directoryIdentity.fileCount))} ] && [ "$directory_count" = ${shellQuote(String(state.directoryIdentity.directoryCount))} ] && [ "$total_bytes" = ${shellQuote(String(state.directoryIdentity.totalBytes))} ] && [ "$tree_digest" = ${shellQuote(state.directoryIdentity.treeDigest)} ] || { printf 'PATCH\tnginx-static\trefused\tchanged-root-identity\n'; exit 2; }
${shellQuote(executable)} -c ${shellQuote(state.configPath)} -g 'daemon off;' >"$log" 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tnginx-static\trefused\tstart-failed\n'
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
  printf 'PATCH\tnginx-static\trefused\tnot-listening\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tstatic-http\ttarget-nginx-static-started\n'
printf 'PATCH\tnginx-static\tready\t%s\t%s\n' ${shellQuote(String(state.port))} ${shellQuote(state.configSha256)}
`;
}

export const readNginxStatic = readMoveNginxStaticStateInVm;
export const runNginxStatic = runMoveTargetNginxStaticLoaderInVm;

export async function readCaddyStatic(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["caddyStaticState"]> {
  const parsedArgv = parseCaddyStaticArgv(node);
  if (!parsedArgv || resourcePlan.resources.filter((r) => r.kind === "socket").length < 1) {
    return undefined;
  }
  const result = await vm.execRaw(
    caddyStaticPreflightCommand(parsedArgv.root, parsedArgv.port, "caddy-static"),
    {
      execTimeoutMs: 30_000,
    },
  );
  const parsed = parseCaddyStaticPreflight(result.stdout);
  return result.exitCode === 0 && parsed
    ? {
        port: parsed.port,
        root: parsed.root,
        argvContract: "caddy-file-server-listen-root",
        listenerState: "idle-single-listener",
        directoryIdentity: parsed.directoryIdentity,
        binaryPolicy: "proof-provisioned-target-native-caddy",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runCaddyStatic(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = "/usr/bin/caddy";
  const state = descriptor.resourcePlan?.capture?.caddyStaticState;
  const result = await vm.execRaw(moveCaddyStaticLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "caddy-static");
  const refusals = moveNamedLoaderRefusals(patch, "target caddy static loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-native-caddy-static-loader",
    executable,
    argv: state
      ? [executable, "file-server", "--listen", `:${state.port}`, "--root", state.root]
      : [executable],
    targetPid: parseLoadPid(result.stdout),
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function parseCaddyStaticArgv(node: MovePidGraphNode): { port: number; root: string } | undefined {
  if (moveCommandName(node) !== "caddy" || node.argv.length !== 6) {
    return undefined;
  }
  const port = Number((node.argv[3] ?? "").replace(/^:/, ""));
  const root = node.argv[5];
  return node.argv[1] === "file-server" &&
    node.argv[2] === "--listen" &&
    /^:\d+$/.test(node.argv[3] ?? "") &&
    node.argv[4] === "--root" &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
    safePath(root)
    ? { port, root }
    : undefined;
}

function caddyStaticPreflightCommand(root: string, port: number, patchName: string): string {
  return `set -eu
tcp_state_for_port() { awk -v p="$(printf '%04X' "$1")" -v s="$2" '$4 == s { split($2, a, ":"); if (toupper(a[2]) == p) found=1 } END { exit found ? 0 : 1 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null; }
root=${shellQuote(root)}
port=${shellQuote(String(port))}
[ -d "$root" ] && [ ! -L "$root" ] || { printf 'PATCH\t${patchName}\trefused\tmissing-root\n'; exit 2; }
if tcp_state_for_port "$port" 01; then
  printf 'PATCH\t${patchName}\trefused\tactive-connection\n'
  exit 2
fi
if find "$root" -type l -print -quit | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tsymlink-entry-unsupported\n'
  exit 2
fi
if find "$root" -printf '%P\n' | LC_ALL=C grep -Ev '^([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]*$' | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tunsafe-directory-path\n'
  exit 2
fi
tree_file=/tmp/machinen-caddy-directory-$$.txt
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
file_count=$(awk -F '\t' '$2 == "file" { n++ } END { print n + 0 }' "$tree_file")
directory_count=$(awk -F '\t' '$2 == "directory" { n++ } END { print n + 0 }' "$tree_file")
total_bytes=$(awk -F '\t' '$2 == "file" { n += $4 } END { print n + 0 }' "$tree_file")
tree_digest=$(sha256sum "$tree_file" | cut -d' ' -f1)
rm -f "$tree_file"
printf 'CADDY_STATIC_OK\t%s\t%s\t%s\t%s\t%s\t%s\n' "$port" "$root" "$file_count" "$directory_count" "$total_bytes" "$tree_digest"
`;
}

function moveCaddyStaticLoaderCommand(
  executable: string,
  state: MoveCaddyStaticState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tcaddy-static\\trefused\\tmissing-caddy-static-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-caddy-loader-$$.log";
  const preflight = caddyStaticPreflightCommand(state.root, state.port, "caddy-static");
  return `set -eu
log=${shellQuote(log)}
if [ ! -x ${shellQuote(executable)} ]; then
  printf 'PATCH\tcaddy-static\trefused\tmissing-caddy\n'
  exit 2
fi
tcp_state_for_port() { awk -v p="$(printf '%04X' "$1")" -v s="$2" '$4 == s { split($2, a, ":"); if (toupper(a[2]) == p) found=1 } END { exit found ? 0 : 1 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null; }
if tcp_state_for_port ${state.port} 0A; then
  printf 'PATCH\tcaddy-static\trefused\tport-in-use\n'
  exit 2
fi
preflight_line=$(sh -c ${shellQuote(preflight)} | grep '^CADDY_STATIC_OK')
IFS='\t' read -r _ port root file_count directory_count total_bytes tree_digest <<EOF
$preflight_line
EOF
[ "$port" = ${shellQuote(String(state.port))} ] && [ "$root" = ${shellQuote(state.root)} ] || { printf 'PATCH\tcaddy-static\trefused\tchanged-root\n'; exit 2; }
[ "$file_count" = ${shellQuote(String(state.directoryIdentity.fileCount))} ] && [ "$directory_count" = ${shellQuote(String(state.directoryIdentity.directoryCount))} ] && [ "$total_bytes" = ${shellQuote(String(state.directoryIdentity.totalBytes))} ] && [ "$tree_digest" = ${shellQuote(state.directoryIdentity.treeDigest)} ] || { printf 'PATCH\tcaddy-static\trefused\tchanged-root-identity\n'; exit 2; }
${shellQuote(executable)} file-server --listen :${state.port} --root ${shellQuote(state.root)} >"$log" 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tcaddy-static\trefused\tstart-failed\n'
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
  printf 'PATCH\tcaddy-static\trefused\tnot-listening\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tstatic-http\ttarget-caddy-static-started\n'
printf 'PATCH\tcaddy-static\tready\t%s\t%s\n' ${shellQuote(String(state.port))} ${shellQuote(state.root)}
`;
}

export async function readRubyHttpState(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["rubyHttpState"]> {
  const parsedArgv = parseRubyHttpArgv(node);
  if (!parsedArgv || resourcePlan.resources.filter((r) => r.kind === "socket").length < 1) {
    return undefined;
  }
  const result = await vm.execRaw(
    caddyStaticPreflightCommand(parsedArgv.root, parsedArgv.port, "ruby-http"),
    {
      execTimeoutMs: 30_000,
    },
  );
  const parsed = parseCaddyStaticPreflight(result.stdout);
  return result.exitCode === 0 && parsed
    ? {
        port: parsed.port,
        root: parsed.root,
        argvContract: "ruby-run-httpd-root-port",
        listenerState: "idle-single-listener",
        directoryIdentity: parsed.directoryIdentity,
        binaryPolicy: "proof-provisioned-target-native-ruby",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runRubyHttp(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = "/usr/bin/ruby";
  const state = descriptor.resourcePlan?.capture?.rubyHttpState;
  const result = await vm.execRaw(moveRubyHttpLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "ruby-http");
  const refusals = moveNamedLoaderRefusals(patch, "target ruby http loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-native-ruby-httpd-loader",
    executable,
    argv: state
      ? [executable, "-run", "-e", "httpd", state.root, "-p", String(state.port)]
      : [executable],
    targetPid: parseLoadPid(result.stdout),
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function parseRubyHttpArgv(node: MovePidGraphNode): { port: number; root: string } | undefined {
  if (moveCommandName(node) !== "ruby" || node.argv.length !== 7) {
    return undefined;
  }
  const port = Number(node.argv[6]);
  const root = node.argv[4];
  return node.argv[1] === "-run" &&
    node.argv[2] === "-e" &&
    node.argv[3] === "httpd" &&
    node.argv[5] === "-p" &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
    safePath(root)
    ? { port, root }
    : undefined;
}

function moveRubyHttpLoaderCommand(
  executable: string,
  state: MoveRubyHttpState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\truby-http\\trefused\\tmissing-ruby-http-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-ruby-http-loader-$$.log";
  const preflight = caddyStaticPreflightCommand(state.root, state.port, "ruby-http");
  return `set -eu
log=${shellQuote(log)}
if [ ! -x ${shellQuote(executable)} ]; then
  printf 'PATCH\truby-http\trefused\tmissing-ruby\n'
  exit 2
fi
tcp_state_for_port() { awk -v p="$(printf '%04X' "$1")" -v s="$2" '$4 == s { split($2, a, ":"); if (toupper(a[2]) == p) found=1 } END { exit found ? 0 : 1 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null; }
if tcp_state_for_port ${state.port} 0A; then
  printf 'PATCH\truby-http\trefused\tport-in-use\n'
  exit 2
fi
preflight_line=$(sh -c ${shellQuote(preflight)} | grep '^CADDY_STATIC_OK')
IFS='\t' read -r _ port root file_count directory_count total_bytes tree_digest <<EOF
$preflight_line
EOF
[ "$port" = ${shellQuote(String(state.port))} ] && [ "$root" = ${shellQuote(state.root)} ] || { printf 'PATCH\truby-http\trefused\tchanged-root\n'; exit 2; }
[ "$file_count" = ${shellQuote(String(state.directoryIdentity.fileCount))} ] && [ "$directory_count" = ${shellQuote(String(state.directoryIdentity.directoryCount))} ] && [ "$total_bytes" = ${shellQuote(String(state.directoryIdentity.totalBytes))} ] && [ "$tree_digest" = ${shellQuote(state.directoryIdentity.treeDigest)} ] || { printf 'PATCH\truby-http\trefused\tchanged-root-identity\n'; exit 2; }
${shellQuote(executable)} -run -e httpd ${shellQuote(state.root)} -p ${state.port} >"$log" 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\truby-http\trefused\tstart-failed\n'
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
  printf 'PATCH\truby-http\trefused\tnot-listening\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tstatic-http\ttarget-ruby-httpd-started\n'
printf 'PATCH\truby-http\tready\t%s\t%s\n' ${shellQuote(String(state.port))} ${shellQuote(state.root)}
`;
}

export async function readPhpStaticState(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["phpStaticState"]> {
  const parsedArgv = parsePhpStaticArgv(node);
  if (!parsedArgv || resourcePlan.resources.filter((r) => r.kind === "socket").length < 1) {
    return undefined;
  }
  const result = await vm.execRaw(
    phpStaticPreflightCommand(parsedArgv.root, parsedArgv.port, "php-static"),
    {
      execTimeoutMs: 30_000,
    },
  );
  const parsed = parseCaddyStaticPreflight(result.stdout);
  return result.exitCode === 0 && parsed
    ? {
        port: parsed.port,
        root: parsed.root,
        argvContract: "php-built-in-server-local-root",
        dynamicPolicy: "no-php-scripts",
        listenerState: "idle-single-listener",
        directoryIdentity: parsed.directoryIdentity,
        binaryPolicy: "proof-provisioned-target-native-php",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runPhpStatic(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = "/usr/bin/php";
  const state = descriptor.resourcePlan?.capture?.phpStaticState;
  const result = await vm.execRaw(movePhpStaticLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "php-static");
  const refusals = moveNamedLoaderRefusals(patch, "target php static loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-native-php-static-loader",
    executable,
    argv: state ? [executable, "-S", `127.0.0.1:${state.port}`, "-t", state.root] : [executable],
    targetPid: parseLoadPid(result.stdout),
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function parsePhpStaticArgv(node: MovePidGraphNode): { port: number; root: string } | undefined {
  if (moveCommandName(node) !== "php" || node.argv.length !== 5) {
    return undefined;
  }
  const match = node.argv[2]?.match(/^127\.0\.0\.1:(\d+)$/);
  const port = Number(match?.[1]);
  const root = node.argv[4];
  return node.argv[1] === "-S" &&
    node.argv[3] === "-t" &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
    safePath(root)
    ? { port, root }
    : undefined;
}

function phpStaticPreflightCommand(root: string, port: number, patchName: string): string {
  return `set -eu
root=${shellQuote(root)}
if find "$root" -type f -iname '*.php' -print -quit | grep -q .; then
  printf 'PATCH\t${patchName}\trefused\tdynamic-php-script\n'
  exit 2
fi
${caddyStaticPreflightCommand(root, port, patchName)}`;
}

function movePhpStaticLoaderCommand(
  executable: string,
  state: MovePhpStaticState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tphp-static\\trefused\\tmissing-php-static-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-php-static-loader-$$.log";
  const preflight = phpStaticPreflightCommand(state.root, state.port, "php-static");
  return `set -eu
log=${shellQuote(log)}
if [ ! -x ${shellQuote(executable)} ]; then
  printf 'PATCH\tphp-static\trefused\tmissing-php\n'
  exit 2
fi
tcp_state_for_port() { awk -v p="$(printf '%04X' "$1")" -v s="$2" '$4 == s { split($2, a, ":"); if (toupper(a[2]) == p) found=1 } END { exit found ? 0 : 1 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null; }
if tcp_state_for_port ${state.port} 0A; then
  printf 'PATCH\tphp-static\trefused\tport-in-use\n'
  exit 2
fi
preflight_line=$(sh -c ${shellQuote(preflight)} | grep '^CADDY_STATIC_OK')
IFS='\t' read -r _ port root file_count directory_count total_bytes tree_digest <<EOF
$preflight_line
EOF
[ "$port" = ${shellQuote(String(state.port))} ] && [ "$root" = ${shellQuote(state.root)} ] || { printf 'PATCH\tphp-static\trefused\tchanged-root\n'; exit 2; }
[ "$file_count" = ${shellQuote(String(state.directoryIdentity.fileCount))} ] && [ "$directory_count" = ${shellQuote(String(state.directoryIdentity.directoryCount))} ] && [ "$total_bytes" = ${shellQuote(String(state.directoryIdentity.totalBytes))} ] && [ "$tree_digest" = ${shellQuote(state.directoryIdentity.treeDigest)} ] || { printf 'PATCH\tphp-static\trefused\tchanged-root-identity\n'; exit 2; }
${shellQuote(executable)} -S 127.0.0.1:${state.port} -t ${shellQuote(state.root)} >"$log" 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tphp-static\trefused\tstart-failed\n'
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
  printf 'PATCH\tphp-static\trefused\tnot-listening\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tstatic-http\ttarget-php-static-started\n'
printf 'PATCH\tphp-static\tready\t%s\t%s\n' ${shellQuote(String(state.port))} ${shellQuote(state.root)}
`;
}

interface CaddyParsedState {
  port: number;
  root: string;
  directoryIdentity: MoveCaddyStaticState["directoryIdentity"];
}

function parseCaddyStaticPreflight(stdout: string): CaddyParsedState | undefined {
  const row = stdout
    .trim()
    .split("\n")
    .find((line) => line.startsWith("CADDY_STATIC_OK\t"));
  const [, portText, root, fileText, dirText, bytesText, treeDigest] = row?.split("\t") ?? [];
  const port = Number(portText);
  const fileCount = Number(fileText);
  const directoryCount = Number(dirText);
  const totalBytes = Number(bytesText);
  return Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
    safePath(root) &&
    Number.isSafeInteger(fileCount) &&
    fileCount >= 0 &&
    Number.isSafeInteger(directoryCount) &&
    directoryCount > 0 &&
    Number.isSafeInteger(totalBytes) &&
    totalBytes >= 0 &&
    /^[0-9a-f]{64}$/.test(treeDigest ?? "")
    ? {
        port,
        root: root as string,
        directoryIdentity: {
          fileCount,
          directoryCount,
          totalBytes,
          treeDigest: treeDigest as string,
        },
      }
    : undefined;
}

interface NginxParsedState {
  port: number;
  root: string;
  configSha256: string;
  directoryIdentity: MoveNginxStaticState["directoryIdentity"];
}

function parseNginxStaticPreflight(stdout: string): NginxParsedState | undefined {
  const row = stdout
    .trim()
    .split("\n")
    .find((line) => line.startsWith("NGINX_STATIC_OK\t"));
  const [, portText, root, configSha256, fileText, dirText, bytesText, treeDigest] =
    row?.split("\t") ?? [];
  const port = Number(portText);
  const fileCount = Number(fileText);
  const directoryCount = Number(dirText);
  const totalBytes = Number(bytesText);
  return Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
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
