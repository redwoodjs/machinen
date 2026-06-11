import type {
  MoveDescriptor,
  MovePidGraphNode,
  NativeProcessImageRefusal,
  VmHandle,
} from "@machinen/runtime";

import { shellQuote } from "./move-preflight-helpers.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type MoveCapture = NonNullable<MoveResourcePlan["capture"]>;
type MoveLoadDirectLoader = {
  state: "ready" | "refused";
  strategy: string;
  executable: string;
  argv: string[];
  targetPid?: number;
  logPath?: string;
  patch?: { state: "ready" | "refused"; stdout: string; stderr: string; exitCode: number };
  refusals: NativeProcessImageRefusal[];
};
type GenericState = NonNullable<MoveCapture["genericResourceGraphState"]>;
type GenericResourceClass = GenericState["resourceClasses"][number];
type GenericRefusalClass = GenericState["refusalClasses"][number];

type GenericPreflight = {
  uid?: number;
  gid?: number;
  root?: string;
  cwd?: GenericState["cwd"]["identity"];
  files: Array<{ fd: number; path: string; size: number; sha256: string }>;
  tcp: Array<{
    fd: number;
    inode: string;
    state: string;
    localHost?: string;
    localPort?: number;
    remoteHost?: string;
    remotePort?: number;
  }>;
};

export async function readMoveGenericResourceGraphStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  executablePath: string,
  executablePackage?: MoveCapture["executablePackage"],
): Promise<MoveCapture["genericResourceGraphState"]> {
  const result = await vm.execRaw(genericResourceGraphPreflightCommand(node.pid), {
    execTimeoutMs: 30_000,
  });
  return result.exitCode === 0
    ? buildMoveGenericResourceGraphState(
        node,
        resourcePlan,
        executablePath,
        result.stdout,
        executablePackage,
      )
    : undefined;
}

export function buildMoveGenericResourceGraphState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  executablePath: string,
  stdout: string,
  executablePackage = resourcePlan.capture?.executablePackage,
): MoveCapture["genericResourceGraphState"] {
  const preflight = parseGenericResourceGraphPreflight(stdout);
  const classifier = classifyGenericResourceGraph(resourcePlan, preflight);
  return {
    policy: "generic-resource-graph-target-native-reexec-v1",
    executableIdentity: executableIdentity(executablePath, executablePackage),
    argv: node.argv,
    env: { policy: "target-default" },
    cwd: { path: node.cwd ?? "/", identity: preflight.cwd },
    root: preflight.root ? { path: preflight.root } : undefined,
    uidGid: uidGid(preflight),
    ports: listenerPorts(preflight, classifier.refusals),
    regularFiles: regularFiles(resourcePlan, preflight),
    dataDirs: dataDirs(node, preflight),
    fileOffsets: fileOffsets(resourcePlan),
    stdioPolicy: stdioPolicy(resourcePlan),
    healthProbe: healthProbe(preflight, node),
    resourceClasses: classifier.resourceClasses,
    refusalClasses: classifier.refusals,
    capturedAt: new Date().toISOString(),
  };
}

export function parseGenericResourceGraphPreflight(stdout: string): GenericPreflight {
  const preflight: GenericPreflight = { files: [], tcp: [] };
  for (const line of stdout.split("\n")) {
    const parts = line.split("\t");
    parsePreflightRow(preflight, parts);
  }
  return preflight;
}

function parsePreflightRow(preflight: GenericPreflight, parts: string[]): void {
  if (parts[0] === "STATUS") {
    preflight.uid = number(parts[1]);
    preflight.gid = number(parts[2]);
  } else if (parts[0] === "ROOT") {
    preflight.root = parts[1];
  } else if (parts[0] === "CWD_IDENTITY") {
    preflight.cwd = treeIdentity(parts);
  } else if (parts[0] === "FILE_IDENTITY") {
    pushFileIdentity(preflight, parts);
  } else if (parts[0] === "TCP_FD") {
    pushTcpFd(preflight, parts);
  }
}

function treeIdentity(parts: string[]): GenericState["cwd"]["identity"] | undefined {
  const fileCount = number(parts[2]);
  const directoryCount = number(parts[3]);
  const totalBytes = number(parts[4]);
  const treeDigest = parts[5];
  return fileCount !== undefined &&
    directoryCount !== undefined &&
    totalBytes !== undefined &&
    isSha256(treeDigest)
    ? { fileCount, directoryCount, totalBytes, treeDigest }
    : undefined;
}

function pushFileIdentity(preflight: GenericPreflight, parts: string[]): void {
  const fd = number(parts[1]);
  const size = number(parts[3]);
  const sha256 = parts[4];
  if (fd !== undefined && size !== undefined && isSha256(sha256)) {
    preflight.files.push({ fd, path: parts[2] ?? "", size, sha256 });
  }
}

function pushTcpFd(preflight: GenericPreflight, parts: string[]): void {
  const fd = number(parts[1]);
  const local = parseTcpAddress(parts[4]);
  const remote = parseTcpAddress(parts[5]);
  if (fd !== undefined) {
    preflight.tcp.push({
      fd,
      inode: parts[2] ?? "",
      state: parts[3] ?? "",
      localHost: local?.host,
      localPort: local?.port,
      remoteHost: remote?.host,
      remotePort: remote?.port,
    });
  }
}

function classifyGenericResourceGraph(
  resourcePlan: MoveResourcePlan,
  preflight: GenericPreflight,
): { resourceClasses: GenericResourceClass[]; refusals: GenericRefusalClass[] } {
  const resourceClasses: GenericResourceClass[] = [
    supported("processIdentity", "executable identity is captured by the move descriptor"),
    supported("argvEnvCwd", "argv is captured and cwd is represented in generic graph state"),
  ];
  const refusals = unsupportedResourceRefusals(resourcePlan, preflight);
  if (preflight.files.length > 0) {
    resourceClasses.push(
      supported("regularFileIdentity", "regular file fd identities include size and sha256"),
    );
  }
  if (preflight.cwd) {
    resourceClasses.push(
      supported("directoryIdentity", "cwd tree identity includes counts and digest"),
    );
  }
  if (listenerPorts(preflight, refusals).length > 0) {
    resourceClasses.push(
      supported("loopbackTcpListener", "loopback TCP listeners have no active clients"),
    );
    resourceClasses.push(
      supported("healthProbe", "tcp-connect health probe can be inferred from listener"),
    );
  }
  for (const refusal of refusals) {
    resourceClasses.push({
      resourceClass: refusal.resourceClass,
      status: refusal.status,
      evidence: refusal.evidence,
    });
  }
  return { resourceClasses, refusals };
}

function unsupportedResourceRefusals(
  resourcePlan: MoveResourcePlan,
  preflight: GenericPreflight,
): GenericRefusalClass[] {
  const refusals = resourcePlan.resources.flatMap((resource) =>
    resourceRefusal(resource.kind, resource.fd, resource.path, preflight),
  );
  if (hasActiveTcp(preflight)) {
    refusals.push(
      refusal(
        "activeTcpConnection",
        "active TCP connection cannot be generically reexeced",
        "proc net tcp state 01 observed",
      ),
    );
  }
  if (stdioPolicy(resourcePlan) === "refuse-nontrivial-stdio") {
    refusals.push(
      refusal("stdio", "stdio is not closed or /dev/null", "fd 0/1/2 has non-trivial target"),
    );
  }
  return dedupeRefusals(refusals);
}

function resourceRefusal(
  kind: string,
  fd: number | undefined,
  path: string | undefined,
  preflight: GenericPreflight,
): GenericRefusalClass[] {
  const handlers: Record<string, () => GenericRefusalClass[]> = {
    argv: () => [],
    cwd: () => [],
    file: () => fileResourceRefusal(fd, path),
    socket: () => socketResourceRefusal(fd, path, preflight),
    pipe: () => unsupportedResourceClassRefusal("pipe", fd, path),
    pty: () => unsupportedResourceClassRefusal("pty", fd, path),
    unknown: () => unsupportedResourceClassRefusal("unknown", fd, path),
  };
  return handlers[kind]?.() ?? deferredResourceClassRefusal(kind, fd, path);
}

function fileResourceRefusal(
  fd: number | undefined,
  path: string | undefined,
): GenericRefusalClass[] {
  return path?.startsWith("/dev/") && path !== "/dev/null"
    ? [refusal("device", "device fd is not generically supported yet", evidence(fd, path))]
    : [];
}

function socketResourceRefusal(
  fd: number | undefined,
  path: string | undefined,
  preflight: GenericPreflight,
): GenericRefusalClass[] {
  return isIdleLoopbackListener(preflight, fd)
    ? []
    : [refusal("socket", "socket fd is not a proven idle loopback listener", evidence(fd, path))];
}

function unsupportedResourceClassRefusal(
  kind: "pipe" | "pty" | "unknown",
  fd: number | undefined,
  path: string | undefined,
): GenericRefusalClass[] {
  return [
    refusal(kind, `${kind} resource class is not generically supported yet`, evidence(fd, path)),
  ];
}

function deferredResourceClassRefusal(
  kind: string,
  fd: number | undefined,
  path: string | undefined,
): GenericRefusalClass[] {
  return [
    refusal(
      kind,
      `${kind} resource class is deferred for generic graph move`,
      evidence(fd, path),
      "deferred",
    ),
  ];
}

function dedupeRefusals(refusals: GenericRefusalClass[]): GenericRefusalClass[] {
  const seen = new Set<string>();
  return refusals.filter((item) => {
    const key = `${item.resourceClass}\t${item.evidence}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isIdleLoopbackListener(preflight: GenericPreflight, fd: number | undefined): boolean {
  return preflight.tcp.some(
    (tcp) => tcp.fd === fd && tcp.state === "0A" && tcp.localHost === "127.0.0.1" && tcp.localPort,
  );
}

function listenerPorts(
  preflight: GenericPreflight,
  refusals: GenericRefusalClass[],
): GenericState["ports"] {
  if (refusals.some((item) => item.resourceClass === "activeTcpConnection")) {
    return [];
  }
  return preflight.tcp
    .filter((tcp) => tcp.state === "0A" && tcp.localHost === "127.0.0.1" && tcp.localPort)
    .map((tcp) => ({
      protocol: "tcp" as const,
      port: tcp.localPort!,
      bindAddress: "127.0.0.1" as const,
      state: "idle-loopback-listener" as const,
      noActiveClients: true as const,
    }));
}

function regularFiles(
  resourcePlan: MoveResourcePlan,
  preflight: GenericPreflight,
): GenericState["regularFiles"] {
  return preflight.files.map((file) => {
    const resource = resourcePlan.resources.find((item) => item.fd === file.fd);
    return {
      fd: file.fd,
      path: file.path,
      access: "read-only" as const,
      flags: resource?.flags,
      offset: resource?.offset,
      identity: { size: file.size, sha256: file.sha256 },
    };
  });
}

function dataDirs(node: MovePidGraphNode, preflight: GenericPreflight): GenericState["dataDirs"] {
  return node.cwd && preflight.cwd
    ? [{ path: node.cwd, access: "write-validated", identity: preflight.cwd }]
    : [];
}

function fileOffsets(resourcePlan: MoveResourcePlan): GenericState["fileOffsets"] {
  return resourcePlan.resources
    .filter(
      (resource) =>
        resource.kind === "file" && resource.fd !== undefined && resource.offset !== undefined,
    )
    .map((resource) => ({
      fd: resource.fd!,
      offset: resource.offset!,
      policy: "absolute-offset" as const,
    }));
}

function stdioPolicy(resourcePlan: MoveResourcePlan): GenericState["stdioPolicy"] {
  const stdio = resourcePlan.resources.filter((resource) => [0, 1, 2].includes(resource.fd ?? -1));
  return stdio.every((resource) => resource.path === "/dev/null")
    ? "stdio-dev-null-or-closed"
    : "refuse-nontrivial-stdio";
}

function healthProbe(
  preflight: GenericPreflight,
  node: MovePidGraphNode,
): GenericState["healthProbe"] {
  const port = preflight.tcp.find(
    (tcp) => tcp.state === "0A" && tcp.localHost === "127.0.0.1",
  )?.localPort;
  if (!port) {
    return { kind: "process-alive" };
  }
  return looksLikePythonHttpServer(node.argv)
    ? { kind: "http", url: `http://127.0.0.1:${port}/`, expectedStatus: 200 }
    : { kind: "tcp-connect", host: "127.0.0.1", port };
}

function looksLikePythonHttpServer(argv: string[]): boolean {
  return argv.some((arg) => arg === "http.server") && argv.some((arg) => arg === "-m");
}

function executableIdentity(
  executablePath: string,
  captured: MoveCapture["executablePackage"],
): GenericState["executableIdentity"] {
  return {
    path: captured?.path ?? executablePath,
    realPath: captured?.realPath,
    packageName: captured?.packageName,
    version: captured?.version,
    architecture: captured?.architecture,
  };
}

function uidGid(preflight: GenericPreflight): GenericState["uidGid"] | undefined {
  return preflight.uid !== undefined && preflight.gid !== undefined
    ? { uid: preflight.uid, gid: preflight.gid }
    : undefined;
}

function hasActiveTcp(preflight: GenericPreflight): boolean {
  return preflight.tcp.some((tcp) => tcp.state === "01");
}

function supported(resourceClass: string, evidence: string): GenericResourceClass {
  return { resourceClass, status: "supported", evidence };
}

function refusal(
  resourceClass: string,
  reason: string,
  evidenceText: string,
  status: GenericRefusalClass["status"] = "refused",
): GenericRefusalClass {
  return {
    resourceClass,
    status,
    reason,
    evidence: evidenceText,
    nextAction: `graduate ${resourceClass} resource class or keep generic save refused`,
  };
}

function evidence(fd: number | undefined, path: string | undefined): string {
  return `fd=${fd ?? "unknown"} path=${path ?? "unknown"}`;
}

function parseTcpAddress(value: string | undefined): { host: string; port: number } | undefined {
  const [address, portHex] = (value ?? "").split(":");
  if (!address || !portHex || address.length !== 8) {
    return undefined;
  }
  const bytes = address
    .match(/../g)
    ?.reverse()
    .map((byte) => Number.parseInt(byte, 16));
  const port = Number.parseInt(portHex, 16);
  return bytes?.every((byte) => Number.isInteger(byte)) && Number.isInteger(port)
    ? { host: bytes.join("."), port }
    : undefined;
}

function number(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function isSha256(value: string | undefined): value is string {
  return /^[0-9a-f]{64}$/.test(value ?? "");
}

function genericResourceGraphPreflightCommand(pid: number): string {
  return `set -eu
pid=${shellQuote(String(pid))}
status_file=/proc/$pid/status
uid=$(awk '/^Uid:/ {print $2}' "$status_file")
gid=$(awk '/^Gid:/ {print $2}' "$status_file")
printf 'STATUS\t%s\t%s\n' "$uid" "$gid"
root=$(readlink "/proc/$pid/root" 2>/dev/null || true)
printf 'ROOT\t%s\n' "$root"
cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
if [ -n "$cwd" ] && [ "$cwd" != "/" ] && [ -d "$cwd" ] && [ ! -L "$cwd" ]; then
  tree_file=/tmp/machinen-generic-cwd-$$.txt
  find "$cwd" -xdev -printf '%P\t%y\t%s\t%m\n' | LC_ALL=C sort >"$tree_file"
  file_count=$(find "$cwd" -xdev -type f | wc -l | tr -d ' ')
  dir_count=$(find "$cwd" -xdev -type d | wc -l | tr -d ' ')
  total_bytes=$(find "$cwd" -xdev -type f -printf '%s\n' | awk '{s += $1} END {print s + 0}')
  digest=$(sha256sum "$tree_file" | cut -d' ' -f1)
  rm -f "$tree_file"
  printf 'CWD_IDENTITY\t%s\t%s\t%s\t%s\t%s\n' "$cwd" "$file_count" "$dir_count" "$total_bytes" "$digest"
fi
for fdpath in /proc/$pid/fd/[0-9]*; do
  [ -e "$fdpath" ] || continue
  fd=$(basename "$fdpath")
  target=$(readlink "$fdpath" 2>/dev/null || true)
  if [ -n "$target" ] && [ -f "$target" ] && [ ! -L "$target" ]; then
    size=$(stat -c %s "$target")
    sha=$(sha256sum "$target" | cut -d' ' -f1)
    printf 'FILE_IDENTITY\t%s\t%s\t%s\t%s\n' "$fd" "$target" "$size" "$sha"
  fi
done
for fdpath in /proc/$pid/fd/[0-9]*; do
  [ -e "$fdpath" ] || continue
  fd=$(basename "$fdpath")
  target=$(readlink "$fdpath" 2>/dev/null || true)
  inode=$(printf '%s' "$target" | sed -n 's/^socket:\\[\\([0-9][0-9]*\\)\\]$/\\1/p')
  [ -n "$inode" ] || continue
  awk -v fd="$fd" -v inode="$inode" '$10 == inode { printf "TCP_FD\\t%s\\t%s\\t%s\\t%s\\t%s\\n", fd, inode, $4, $2, $3 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null || true
done
`;
}

export async function runMoveTargetGenericResourceGraphLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const state = descriptor.resourcePlan?.capture?.genericResourceGraphState;
  const executable = state?.executableIdentity.path ?? descriptor.nodes[0]?.exe ?? "/bin/false";
  const argv = state?.argv.length ? state.argv : [executable];
  const result = await vm.execRaw(genericResourceGraphLoaderCommand(state), {
    execTimeoutMs: 30_000,
  });
  const parsed = parseGenericLoaderOutput(result.stdout);
  const ready = result.exitCode === 0 && parsed.patchState === "ready" && parsed.pid !== undefined;
  return {
    state: ready ? "ready" : "refused",
    strategy: "target-native-generic-resource-graph-reexec-loader",
    executable,
    argv,
    targetPid: ready ? parsed.pid : undefined,
    logPath: parsed.logPath,
    patch: {
      state: ready ? "ready" : "refused",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    },
    refusals: ready ? [] : [genericLoaderRefusal(parsed.reason ?? "generic-preflight-refused")],
  };
}

export function genericResourceGraphLoaderCommand(state: GenericState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tgeneric-resource-graph\\trefused\\tmissing-state\\n'; exit 2";
  }
  if (state.refusalClasses.length > 0) {
    const reason = state.refusalClasses[0]?.resourceClass ?? "unsupported-resource";
    return `printf 'PATCH\tgeneric-resource-graph\trefused\t${shellEscape(reason)}\n'; exit 2`;
  }
  const executable = state.executableIdentity.path;
  const preflight = [
    `test -x ${shellQuote(executable)} || fail executable-missing`,
    state.executableIdentity.sha256
      ? `[ "$(sha256sum ${shellQuote(executable)} | cut -d' ' -f1)" = ${shellQuote(state.executableIdentity.sha256)} ] || fail executable-identity-mismatch`
      : "",
    `test -d ${shellQuote(state.cwd.path)} || fail cwd-missing`,
    state.root?.path && state.root.path !== "/" ? "fail root-unsupported" : "",
    ...state.regularFiles.map(
      (file) => `test -f ${shellQuote(file.path)} || fail file-missing
[ "$(stat -c %s ${shellQuote(file.path)})" = ${shellQuote(String(file.identity.size))} ] || fail file-size-mismatch
[ "$(sha256sum ${shellQuote(file.path)} | cut -d' ' -f1)" = ${shellQuote(file.identity.sha256)} ] || fail file-identity-mismatch`,
    ),
    ...state.dataDirs.map((dir) => dataDirPreflight(dir)),
    ...state.ports.map((port) => portPreflight(port.bindAddress, port.port)),
  ].filter(Boolean);
  return `set -eu
fail() { printf 'PATCH\tgeneric-resource-graph\trefused\t%s\n' "$1"; exit 2; }
${preflight.join("\n")}
log=/tmp/machinen-move-generic-$$.log
cd ${shellQuote(state.cwd.path)}
${state.argv.map(shellQuote).join(" ")} >"$log" 2>&1 &
pid=$!
probe_fail() { kill -TERM "$pid" 2>/dev/null || true; printf 'PATCH\tgeneric-resource-graph\trefused\t%s\n' "$1"; exit 2; }
${healthProbeCommand(state.healthProbe)}
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tgeneric-resource-graph\ttarget-native-reexec-started\n'
printf 'PATCH\tgeneric-resource-graph\tready\t%s\n' "$pid"
`;
}

function healthProbeCommand(probe: GenericState["healthProbe"]): string {
  if (probe.kind === "process-alive") {
    return `kill -0 "$pid" 2>/dev/null || probe_fail health-process-dead`;
  }
  if (probe.kind === "tcp-connect") {
    return probe.expectedBannerSha256
      ? tcpBannerProbeCommand(probe.host, probe.port, probe.expectedBannerSha256)
      : tcpConnectProbeCommand(probe.host, probe.port, "health-tcp-connect-failed");
  }
  if (probe.kind === "http") {
    return `python3 - ${shellQuote(probe.url)} ${shellQuote(String(probe.expectedStatus ?? 200))} <<'PY' || probe_fail health-http-failed
import sys, urllib.request
response = urllib.request.urlopen(sys.argv[1], timeout=1)
sys.exit(0 if response.status == int(sys.argv[2]) else 1)
PY`;
  }
  if (probe.kind === "command") {
    const digestCheck = probe.expectedStdoutSha256
      ? `[ "$(sha256sum /tmp/machinen-generic-health-$$.out | cut -d' ' -f1)" = ${shellQuote(probe.expectedStdoutSha256)} ] || probe_fail health-command-digest-mismatch`
      : "";
    return `${probe.argv.map(shellQuote).join(" ")} >/tmp/machinen-generic-health-$$.out 2>/dev/null || probe_fail health-command-failed
${digestCheck}`;
  }
  return "probe_fail health-probe-unsupported";
}

function tcpConnectProbeCommand(host: string, port: number, reason: string): string {
  return `python3 - ${shellQuote(host)} ${shellQuote(String(port))} <<'PY' || probe_fail ${reason}
import socket, sys
s = socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=1)
s.close()
PY`;
}

function tcpBannerProbeCommand(host: string, port: number, expectedSha256: string): string {
  return `python3 - ${shellQuote(host)} ${shellQuote(String(port))} ${shellQuote(expectedSha256)} <<'PY' || probe_fail health-tcp-banner-failed
import hashlib, socket, sys
s = socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=1)
data = s.recv(4096)
s.close()
sys.exit(0 if hashlib.sha256(data).hexdigest() == sys.argv[3] else 1)
PY`;
}

function dataDirPreflight(dir: GenericState["dataDirs"][number]): string {
  const path = shellQuote(dir.path);
  const check =
    dir.access === "write-validated"
      ? `test -w ${path} || fail data-dir-not-writable`
      : `test -d ${path} || fail data-dir-missing`;
  const identity = dir.identity
    ? `tree_file=/tmp/machinen-generic-loader-tree-$$.txt
find ${path} -xdev -printf '%P\t%y\t%s\t%m\n' | LC_ALL=C sort >"$tree_file"
[ "$(find ${path} -xdev -type f | wc -l | tr -d ' ')" = ${shellQuote(String(dir.identity.fileCount))} ] || fail data-dir-file-count-mismatch
[ "$(find ${path} -xdev -type d | wc -l | tr -d ' ')" = ${shellQuote(String(dir.identity.directoryCount))} ] || fail data-dir-directory-count-mismatch
[ "$(find ${path} -xdev -type f -printf '%s\n' | awk '{s += $1} END {print s + 0}')" = ${shellQuote(String(dir.identity.totalBytes))} ] || fail data-dir-total-bytes-mismatch
[ "$(sha256sum "$tree_file" | cut -d' ' -f1)" = ${shellQuote(dir.identity.treeDigest)} ] || fail data-dir-identity-mismatch
rm -f "$tree_file"`
    : "";
  return `${check}
[ -d ${path} ] || fail data-dir-missing
${identity}`;
}

function portPreflight(host: string, port: number): string {
  return `python3 - ${shellQuote(host)} ${shellQuote(String(port))} <<'PY' || fail port-unavailable
import socket, sys
s = socket.socket()
try:
    s.bind((sys.argv[1], int(sys.argv[2])))
finally:
    s.close()
PY`;
}

function parseGenericLoaderOutput(stdout: string): {
  pid?: number;
  logPath?: string;
  patchState?: string;
  reason?: string;
} {
  const parsed: { pid?: number; logPath?: string; patchState?: string; reason?: string } = {};
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.split("\t");
    if (parts[0] === "LOAD_PID") {
      parsed.pid = number(parts[1]);
    }
    if (parts[0] === "LOAD_LOG") {
      parsed.logPath = parts[1];
    }
    if (parts[0] === "PATCH" && parts[1] === "generic-resource-graph") {
      parsed.patchState = parts[2];
      parsed.reason = parts[3];
    }
  }
  return parsed;
}

function genericLoaderRefusal(reason: string): NativeProcessImageRefusal {
  return {
    code: "target-process-context-unsupported",
    message: "generic resource graph loader refused before target launch",
    detail: { reason },
  };
}

function shellEscape(value: string): string {
  return value.replace(/[\\\t\r\n']/g, "-");
}
