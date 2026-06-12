import type {
  MoveDescriptor,
  MovePidGraphNode,
  NativeProcessImageRefusal,
  VmHandle,
} from "@machinen/runtime";

import {
  genericRegularFileCursorLaunchCommand,
  genericRegularFilePreflightCommand,
} from "./move-generic-file-cursor-loader.ts";
import {
  genericPipeLaunchCommand,
  genericPipePreflightCommands,
} from "./move-generic-pipe-loader.ts";
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
type GenericStdioGraph = NonNullable<GenericState["stdioGraph"]>;
type GenericPipeGraph = NonNullable<GenericState["pipeGraph"]>;

type GenericPreflight = {
  uid?: number;
  gid?: number;
  root?: string;
  cwd?: GenericState["cwd"]["identity"];
  files: Array<{
    fd: number;
    path: string;
    dev: number;
    inode: number;
    size: number;
    mtimeEpochSeconds: number;
    sha256: string;
  }>;
  tcp: Array<{
    fd: number;
    inode: string;
    state: string;
    localHost?: string;
    localPort?: number;
    remoteHost?: string;
    remotePort?: number;
  }>;
  locks: string[];
  mmaps: string[];
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
  const classifier = classifyGenericResourceGraph(node, resourcePlan, preflight);
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
    stdioGraph: stdioGraph(resourcePlan),
    pipeGraph: pipeGraph(resourcePlan, node),
    healthProbe: healthProbe(preflight, node),
    resourceClasses: classifier.resourceClasses,
    refusalClasses: classifier.refusals,
    capturedAt: new Date().toISOString(),
  };
}

export function parseGenericResourceGraphPreflight(stdout: string): GenericPreflight {
  const preflight: GenericPreflight = { files: [], tcp: [], locks: [], mmaps: [] };
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
  } else if (parts[0] === "FILE_LOCK") {
    preflight.locks.push(parts.slice(1).join("\t"));
  } else if (parts[0] === "MMAP_FILE") {
    preflight.mmaps.push(parts.slice(1).join("\t"));
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
  const dev = number(parts[3]);
  const inode = number(parts[4]);
  const size = number(parts[5]);
  const mtimeEpochSeconds = number(parts[6]);
  const sha256 = parts[7];
  if (
    fd !== undefined &&
    dev !== undefined &&
    inode !== undefined &&
    size !== undefined &&
    mtimeEpochSeconds !== undefined &&
    isSha256(sha256)
  ) {
    preflight.files.push({
      fd,
      path: parts[2] ?? "",
      dev,
      inode,
      size,
      mtimeEpochSeconds,
      sha256,
    });
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
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  preflight: GenericPreflight,
): { resourceClasses: GenericResourceClass[]; refusals: GenericRefusalClass[] } {
  const resourceClasses: GenericResourceClass[] = [
    supported("processIdentity", "executable identity is captured by the move descriptor"),
    supported("argvEnvCwd", "argv is captured and cwd is represented in generic graph state"),
  ];
  const refusals = unsupportedResourceRefusals(node, resourcePlan, preflight);
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
  if (hasPipeResources(resourcePlan)) {
    resourceClasses.push(
      supported("pipeGraph", "pipe fds are normalized into pipe graph descriptor evidence"),
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
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  preflight: GenericPreflight,
): GenericRefusalClass[] {
  const refusals = resourcePlan.resources.flatMap((resource) =>
    resourceRefusal(resource, preflight),
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
  refusals.push(...fileLockRefusals(preflight), ...mmapRefusals(preflight, resourcePlan));
  if (stdioPolicy(resourcePlan) === "refuse-nontrivial-stdio") {
    refusals.push(
      refusal("stdio", "stdio is not closed or /dev/null", "fd 0/1/2 has non-trivial target"),
    );
  }
  refusals.push(...hiddenShellStateRefusals(node));
  return dedupeRefusals(refusals);
}

function fileLockRefusals(preflight: GenericPreflight): GenericRefusalClass[] {
  return preflight.locks.length > 0
    ? [
        refusal(
          "fileLock",
          "regular-file locks cannot be generically reconstructed",
          preflight.locks.join(" | "),
        ),
      ]
    : [];
}

function mmapRefusals(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): GenericRefusalClass[] {
  const fdPaths = new Set(preflight.files.map((file) => file.path));
  const maps = [...preflight.mmaps, ...(resourcePlan.capture?.maps ?? [])];
  const writableFileMap = maps.find((line) =>
    fdPaths.has(line.trim().split(/\s+/).slice(5).join(" ")),
  );
  return writableFileMap
    ? [
        refusal(
          "mmapFile",
          "writable file-backed mmap state is not generically supported",
          writableFileMap,
        ),
      ]
    : [];
}

function hiddenShellStateRefusals(node: MovePidGraphNode): GenericRefusalClass[] {
  if (!looksLikeShellWrapper(node)) {
    return [];
  }
  return [
    refusal(
      "shellState",
      "shell wrapper state is not a generic pipe/stdio resource graph",
      `command=${node.command} argv=${JSON.stringify(node.argv)}`,
    ),
  ];
}

function looksLikeShellWrapper(node: MovePidGraphNode): boolean {
  const command = node.command.split("/").pop();
  return (
    ["sh", "dash", "bash", "zsh", "fish", "busybox"].includes(command ?? "") &&
    node.argv.some((arg) => arg === "-c")
  );
}

function resourceRefusal(
  resource: MoveResourcePlan["resources"][number],
  preflight: GenericPreflight,
): GenericRefusalClass[] {
  const handlers: Record<string, () => GenericRefusalClass[]> = {
    argv: () => [],
    cwd: () => [],
    file: () => fileResourceRefusal(resource),
    socket: () => socketResourceRefusal(resource.fd, resource.path, preflight),
    pipe: () => unsupportedResourceClassRefusal("pipe", resource.fd, resource.path),
    pty: () => unsupportedResourceClassRefusal("pty", resource.fd, resource.path),
    unknown: () =>
      resource.path?.includes("inotify")
        ? [
            refusal(
              "inotify",
              "inotify/fanotify state is not generically supported",
              evidence(resource.fd, resource.path),
            ),
          ]
        : unsupportedResourceClassRefusal("unknown", resource.fd, resource.path),
  };
  return (
    handlers[resource.kind]?.() ??
    deferredResourceClassRefusal(resource.kind, resource.fd, resource.path)
  );
}

function fileResourceRefusal(
  resource: MoveResourcePlan["resources"][number],
): GenericRefusalClass[] {
  const { fd, path } = resource;
  if (path?.startsWith("/dev/") && path !== "/dev/null") {
    return [refusal("device", "device fd is not generically supported yet", evidence(fd, path))];
  }
  if (path?.endsWith(" (deleted)")) {
    return [
      refusal(
        "regularFileDeleted",
        "deleted regular-file fd cannot be reopened",
        evidence(fd, path),
      ),
    ];
  }
  if (isRegularFilePath(path) && !isReadOnlyFileResource(resource)) {
    return [
      refusal(
        "writableRegularFileCursor",
        "regular-file fd is not proven read-only; generic cursor continuation refuses writable or unknown access",
        `${evidence(fd, path)} flags=${resource.flags?.join(",") ?? "unknown"}`,
      ),
    ];
  }
  return [];
}

function isRegularFilePath(path: string | undefined): boolean {
  return Boolean(path && path.startsWith("/") && !path.startsWith("/dev/"));
}

function isReadOnlyFileResource(resource: MoveResourcePlan["resources"][number]): boolean {
  const octal = resource.flags?.find((flag) => flag.startsWith("octal:"))?.slice("octal:".length);
  if (!octal) {
    return false;
  }
  const flags = Number.parseInt(octal, 8);
  return Number.isInteger(flags) && (flags & 3) === 0;
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
      access: isReadOnlyFileResource(resource ?? { kind: "file", id: "missing", state: "captured" })
        ? ("read-only" as const)
        : ("read-write-refused" as const),
      flags: resource?.flags,
      offset: resource?.offset,
      cursor:
        resource?.offset !== undefined
          ? { offset: resource.offset, policy: "read-only-offset" as const }
          : undefined,
      identity: {
        dev: file.dev,
        inode: file.inode,
        size: file.size,
        mtimeEpochSeconds: file.mtimeEpochSeconds,
        sha256: file.sha256,
      },
    };
  });
}

function dataDirs(node: MovePidGraphNode, preflight: GenericPreflight): GenericState["dataDirs"] {
  return node.cwd && preflight.cwd
    ? [{ path: node.cwd, access: "write-validated", identity: preflight.cwd }]
    : [];
}

function stdioGraph(resourcePlan: MoveResourcePlan): GenericStdioGraph {
  const fds = ([0, 1, 2] as const).map((fd) => stdioFd(resourcePlan, fd));
  return { policy: stdioGraphPolicy(fds), fds };
}

function stdioFd(resourcePlan: MoveResourcePlan, fd: 0 | 1 | 2): GenericStdioGraph["fds"][number] {
  const resource = resourcePlan.resources.find((item) => item.fd === fd);
  const target = stdioTarget(resource?.kind, resource?.path);
  return {
    fd,
    target,
    access: fd === 0 ? "read" : "write",
    evidence: resource?.path ? `fd=${fd} path=${resource.path}` : `fd=${fd} closed-or-unobserved`,
  };
}

function stdioTarget(
  kind: string | undefined,
  path: string | undefined,
): GenericStdioGraph["fds"][number]["target"] {
  if (!kind || !path) {
    return "closed";
  }
  if (path === "/dev/null") {
    return "dev-null";
  }
  if (pipeInode(path)) {
    return "pipe";
  }
  return kind === "file" ? "regular-file" : "refused";
}

function stdioGraphPolicy(fds: GenericStdioGraph["fds"]): GenericStdioGraph["policy"] {
  if (fds.every((fd) => fd.target === "closed" || fd.target === "dev-null")) {
    return "dev-null-or-closed";
  }
  if (fds.some((fd) => fd.target === "refused")) {
    return "refused";
  }
  return fds.some((fd) => fd.target === "pipe") ? "modeled-pipe" : "inherited-noninteractive";
}

function pipeGraph(
  resourcePlan: MoveResourcePlan,
  node: MovePidGraphNode,
): GenericPipeGraph | undefined {
  const endpoints = resourcePlan.resources.flatMap((resource) => pipeEndpoint(resource, node));
  if (endpoints.length === 0) {
    return undefined;
  }
  const byInode = new Map<string, GenericPipeGraph["pipes"][number]["readFds"]>();
  for (const endpoint of endpoints) {
    const list = byInode.get(endpoint.inode) ?? [];
    list.push(endpoint.endpoint);
    byInode.set(endpoint.inode, list);
  }
  return { pipes: [...byInode.entries()].map(([inode, peers]) => pipeDescriptor(inode, peers)) };
}

function pipeEndpoint(
  resource: MoveResourcePlan["resources"][number],
  node: MovePidGraphNode,
): Array<{ inode: string; endpoint: GenericPipeGraph["pipes"][number]["readFds"][number] }> {
  const inode = pipeInode(resource.path);
  if (!inode || resource.fd === undefined) {
    return [];
  }
  return [
    {
      inode,
      endpoint: {
        pid: node.pid,
        fd: resource.fd,
        role: pipeEndpointRole(resource.fd),
        insideMovedGraph: true,
        flags: resource.flags ?? [],
        command: node.command,
        argv: node.argv,
      },
    },
  ];
}

function pipeEndpointRole(fd: number): "producer" | "consumer" | "unknown" {
  if (fd === 0) {
    return "consumer";
  }
  if (fd === 1 || fd === 2) {
    return "producer";
  }
  return "unknown";
}

function pipeDescriptor(
  inode: string,
  endpoints: GenericPipeGraph["pipes"][number]["readFds"],
): GenericPipeGraph["pipes"][number] {
  const readFds = endpoints.filter((endpoint) => endpoint.role === "consumer");
  const writeFds = endpoints.filter((endpoint) => endpoint.role === "producer");
  return {
    inode,
    readFds,
    writeFds,
    topology: pipeTopology(readFds.length, writeFds.length),
    bufferedDataPolicy: "refused-unknown",
    lifecycle: "refused",
  };
}

function pipeTopology(
  readers: number,
  writers: number,
): GenericPipeGraph["pipes"][number]["topology"] {
  if (readers === 1 && writers === 1) {
    return "one-producer-one-consumer";
  }
  if (readers === 0 || writers === 0) {
    return "missing-peer";
  }
  return writers > 1 ? "fan-in" : "fan-out";
}

function pipeInode(path: string | undefined): string | undefined {
  return /^pipe:\[(?<inode>\d+)\]$/.exec(path ?? "")?.groups?.inode;
}

function hasPipeResources(resourcePlan: MoveResourcePlan): boolean {
  return resourcePlan.resources.some((resource) => pipeInode(resource.path));
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
    stat_row=$(stat -c '%d\t%i\t%s\t%Y' "$target")
    sha=$(sha256sum "$target" | cut -d' ' -f1)
    printf 'FILE_IDENTITY\t%s\t%s\t%s\t%s\n' "$fd" "$target" "$stat_row" "$sha"
    python3 - "$target" <<'PY' >/dev/null 2>&1 || printf 'FILE_LOCK\tfd=%s path=%s blocked-lock-probe\n' "$fd" "$target"
import errno, fcntl, sys
try:
    f = open(sys.argv[1], 'r+')
except OSError:
    sys.exit(0)
for op in (fcntl.lockf, fcntl.flock):
    try:
        op(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        sys.exit(1 if exc.errno in (errno.EACCES, errno.EAGAIN) else 0)
sys.exit(0)
PY
  fi
  awk -v fd="$fd" '/^lock:/ { sub(/^lock:[[:space:]]*/, ""); printf "FILE_LOCK\\tfd=%s %s\\n", fd, $0 }' "/proc/$pid/fdinfo/$fd" 2>/dev/null || true
done
for fdpath in /proc/$pid/fd/[0-9]*; do
  [ -e "$fdpath" ] || continue
  fd=$(basename "$fdpath")
  target=$(readlink "$fdpath" 2>/dev/null || true)
  inode=$(printf '%s' "$target" | sed -n 's/^socket:\\[\\([0-9][0-9]*\\)\\]$/\\1/p')
  [ -n "$inode" ] || continue
  awk -v fd="$fd" -v inode="$inode" '$10 == inode { printf "TCP_FD\\t%s\\t%s\\t%s\\t%s\\t%s\\n", fd, inode, $4, $2, $3 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null || true
done
awk -v pid="$pid" '$5 == pid { printf "FILE_LOCK\\t%s\\n", $0 }' /proc/locks 2>/dev/null || true
awk '$2 ~ /w/ && NF >= 6 && $6 ~ /^[/]/ { printf "MMAP_FILE\\t%s\\n", $0 }' "/proc/$pid/maps" 2>/dev/null || true
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
    ...state.regularFiles.map((file) => genericRegularFilePreflightCommand(file)),
    ...state.dataDirs.map((dir) => dataDirPreflight(dir)),
    ...state.ports.map((port) => portPreflight(port.bindAddress, port.port)),
    ...genericPipePreflightCommands(state),
  ].filter(Boolean);
  return `set -eu
fail() { printf 'PATCH\tgeneric-resource-graph\trefused\t%s\n' "$1"; exit 2; }
${preflight.join("\n")}
log=/tmp/machinen-move-generic-$$.log
aux_pids=""
cd ${shellQuote(state.cwd.path)}
${genericLaunchCommand(state)}
probe_fail() { kill -TERM "$pid" $aux_pids 2>/dev/null || true; printf 'PATCH\tgeneric-resource-graph\trefused\t%s\n' "$1"; exit 2; }
${healthProbeCommand(state.healthProbe)}
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tgeneric-resource-graph\ttarget-native-reexec-started\n'
printf 'PATCH\tgeneric-resource-graph\tready\t%s\n' "$pid"
`;
}

function genericLaunchCommand(state: GenericState): string {
  return (
    genericPipeLaunchCommand(state) ??
    genericRegularFileCursorLaunchCommand(state) ??
    `${state.argv.map(shellQuote).join(" ")} >"$log" 2>&1 &
pid=$!`
  );
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
import sys, time, urllib.request
for _ in range(30):
    try:
        response = urllib.request.urlopen(sys.argv[1], timeout=1)
        sys.exit(0 if response.status == int(sys.argv[2]) else 1)
    except Exception:
        time.sleep(0.1)
sys.exit(1)
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
import socket, sys, time
for _ in range(30):
    try:
        s = socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=1)
        s.close()
        sys.exit(0)
    except OSError:
        time.sleep(0.1)
sys.exit(1)
PY`;
}

function tcpBannerProbeCommand(host: string, port: number, expectedSha256: string): string {
  return `python3 - ${shellQuote(host)} ${shellQuote(String(port))} ${shellQuote(expectedSha256)} <<'PY' || probe_fail health-tcp-banner-failed
import hashlib, socket, sys, time
for _ in range(30):
    try:
        s = socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=1)
        data = s.recv(4096)
        s.close()
        sys.exit(0 if hashlib.sha256(data).hexdigest() == sys.argv[3] else 1)
    except OSError:
        time.sleep(0.1)
sys.exit(1)
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
