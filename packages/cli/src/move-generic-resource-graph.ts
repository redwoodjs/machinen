import type {
  MoveDescriptor,
  MovePidGraphNode,
  NativeProcessImageRefusal,
  VmHandle,
} from "@machinen/runtime";
import * as genericAnonInode from "./move-generic-anon-inode.ts";
import { genericEventfdLaunchCommand } from "./move-generic-eventfd-loader.ts";
import { genericTimerfdLaunchCommand } from "./move-generic-timerfd-loader.ts";
import * as genericInotify from "./move-generic-inotify.ts";
import * as genericMmap from "./move-generic-mmap-file.ts";
import {
  genericRegularFileCursorLaunchCommand,
  genericRegularFilePreflightCommand,
} from "./move-generic-file-cursor-loader.ts";
import {
  fileLockRefusals,
  genericFileLockLaunchCommand,
  genericFileLockResourceClasses,
  genericFileLocks,
} from "./move-generic-file-lock.ts";
import { healthProbeCommand } from "./move-generic-health-probes.ts";
import {
  genericProductPathIsPromoted,
  staticHttpTreeIdentityProductPathIsProofSelected,
  staticHttpTreeIdentityProductPathMarkers,
} from "./move-generic-product-path.ts";
import {
  genericPipeLaunchCommand,
  genericPipePreflightCommands,
} from "./move-generic-pipe-loader.ts";
import { genericPtyLaunchCommand } from "./move-generic-pty-loader.ts";
import { genericPtys, supportedNoninteractivePtyProbe } from "./move-generic-pty-terminal.ts";
import * as genericSignal from "./move-generic-signal-state.ts";
import { genericStdioGraph, genericStdioPolicy } from "./move-generic-stdio.ts";
import { genericTerminalBoundaryRefusals } from "./move-generic-terminal-boundaries.ts";
import {
  bespokeIdleListenerPort,
  genericMigrationWave2,
  looksLikePythonHttpServer,
} from "./move-generic-migration-wave2.ts";
import {
  createGenericPreflight,
  genericResourceRefusal,
  parseWave2PreflightRow,
  regularFileAccess,
  regularFileCursor,
  type GenericPreflight,
} from "./move-generic-wave2-baseline.ts";
import {
  firstUnixSocketPath,
  genericUnixSocketPreflightCommands,
  genericUnixSockets,
  supportedUnixPathnameListener,
} from "./move-generic-unix-socket.ts";
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
type GenericPipeGraph = NonNullable<GenericState["pipeGraph"]>;
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
  const migration = genericMigrationWave2(node, resourcePlan, preflight, classifier.refusals);
  return {
    policy: "generic-resource-graph-target-native-reexec-v1",
    migration,
    executableIdentity: executableIdentity(executablePath, executablePackage),
    argv: node.argv,
    env: { policy: "target-default" },
    cwd: { path: node.cwd ?? "/", identity: preflight.cwd },
    root: preflight.root ? { path: preflight.root } : undefined,
    uidGid: uidGid(preflight),
    ports: listenerPorts(preflight, classifier.refusals),
    unixSockets: genericUnixSockets(preflight, resourcePlan),
    regularFiles: regularFiles(resourcePlan, preflight),
    dataDirs: dataDirs(node, resourcePlan, preflight),
    fileOffsets: fileOffsets(resourcePlan),
    fileLocks: genericFileLocks(preflight, resourcePlan),
    stdioPolicy: genericStdioPolicy(resourcePlan, preflight, node),
    stdioGraph: genericStdioGraph(
      resourcePlan,
      supportedNoninteractivePtyProbe(node, resourcePlan, preflight),
    ),
    pipeGraph: pipeGraph(resourcePlan, node),
    eventfds: genericAnonInode.genericEventfds(preflight, resourcePlan),
    epolls: genericAnonInode.genericEpolls(preflight, resourcePlan),
    timers: genericAnonInode.genericTimers(preflight, resourcePlan),
    signalState: genericSignal.genericSignalState(preflight),
    signalfds: genericSignal.genericSignalfds(preflight, resourcePlan),
    inotifyWatches: genericInotify.genericInotifyWatches(preflight, resourcePlan),
    mmapMappings: genericMmap.genericMmapMappings(resourcePlan),
    ptys: genericPtys(preflight, resourcePlan, node),
    healthProbe: healthProbe(preflight, node, resourcePlan, migration),
    resourceClasses: classifier.resourceClasses,
    refusalClasses: classifier.refusals,
    capturedAt: new Date().toISOString(),
  };
}
export function parseGenericResourceGraphPreflight(stdout: string): GenericPreflight {
  const preflight = createGenericPreflight();
  for (const line of stdout.split("\n")) {
    const parts = line.split("\t");
    parsePreflightRow(preflight, parts);
  }
  return preflight;
}
const preflightRowParsers: Record<string, (preflight: GenericPreflight, parts: string[]) => void> =
  {
    STATUS: (preflight, parts) => {
      preflight.uid = number(parts[1]);
      preflight.gid = number(parts[2]);
    },
    ROOT: (preflight, parts) => {
      preflight.root = parts[1];
    },
    CWD_IDENTITY: (preflight, parts) => {
      preflight.cwd = treeIdentity(parts);
    },
    FILE_IDENTITY: pushFileIdentity,
    DATA_DIR_IDENTITY: pushDataDirIdentity,
    TCP_FD: pushTcpFd,
    FILE_LOCK: (preflight, parts) => {
      preflight.locks.push(parts.slice(1).join("\t"));
    },
    MMAP_FILE: (preflight, parts) => {
      preflight.mmaps.push(parts.slice(1).join("\t"));
    },
  };
function parsePreflightRow(preflight: GenericPreflight, parts: string[]): void {
  if (!parseWave2PreflightRow(preflight, parts)) {
    preflightRowParsers[parts[0] ?? ""]?.(preflight, parts);
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
function pushDataDirIdentity(preflight: GenericPreflight, parts: string[]): void {
  const fileCount = number(parts[2]);
  const directoryCount = number(parts[3]);
  const totalBytes = number(parts[4]);
  const treeDigest = parts[5];
  if (
    parts[1] &&
    fileCount !== undefined &&
    directoryCount !== undefined &&
    totalBytes !== undefined &&
    isSha256(treeDigest)
  ) {
    preflight.dataDirs.push({
      path: parts[1],
      fileCount,
      directoryCount,
      totalBytes,
      treeDigest,
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
  resourceClasses.push(
    ...genericAnonInode.genericAnonInodeResourceClasses(preflight, resourcePlan),
    ...genericSignal.genericSignalResourceClasses(preflight, resourcePlan),
    ...genericInotify.genericInotifyResourceClasses(preflight, resourcePlan),
    ...genericMmap.genericMmapResourceClasses(genericMmap.genericMmapMappings(resourcePlan)),
    ...genericFileLockResourceClasses(genericFileLocks(preflight, resourcePlan)),
  );
  if (listenerPorts(preflight, refusals, resourcePlan).length > 0) {
    resourceClasses.push(
      supported("loopbackTcpListener", "loopback TCP listeners have no active clients"),
    );
    resourceClasses.push(
      supported("healthProbe", "tcp-connect health probe can be inferred from listener"),
    );
  }
  if (genericUnixSockets(preflight, resourcePlan).length > 0) {
    resourceClasses.push(
      supported(
        "unixSocketPathnameListener",
        "idle pathname Unix listeners have exact path and no active clients",
      ),
    );
    resourceClasses.push(
      supported("healthProbe", "Unix-connect health probe can be inferred from listener"),
    );
  }
  if (preflight.ptys.length > 0) {
    resourceClasses.push(
      supported(
        "terminalOrPtyEvidence",
        "PTY descriptor evidence records termios, winsize, session, process-group, foreground process-group, and fd flags for fail-closed refusal",
      ),
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
    genericResourceRefusal(
      resource,
      preflight,
      isIdleLoopbackListener(preflight, resource.fd) || isBespokeIdleListener(resourcePlan),
      supportedUnixPathnameListener(preflight, resource),
      genericAnonInode.supportedEventfdCounter(resource, preflight, resourcePlan),
      genericAnonInode.supportedEpollSet(resource, preflight, resourcePlan),
      supportedNoninteractivePtyProbe(node, resourcePlan, preflight),
      genericAnonInode.supportedTimerfd(resource, preflight, resourcePlan),
      genericInotify.supportedInotifyFileFollow(resource, preflight, resourcePlan),
    ),
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
  refusals.push(
    ...fileLockRefusals(genericFileLocks(preflight, resourcePlan)),
    ...genericMmap.genericMmapRefusals(genericMmap.genericMmapMappings(resourcePlan)),
    ...mmapRefusals(preflight, resourcePlan),
    ...genericSignal.genericSignalStateRefusals(preflight),
  );
  if (genericStdioPolicy(resourcePlan, preflight, node) === "refuse-nontrivial-stdio") {
    refusals.push(
      refusal("stdio", "stdio is not closed or /dev/null", "fd 0/1/2 has non-trivial target"),
    );
  }
  refusals.push(...hiddenShellStateRefusals(node));
  refusals.push(...genericTerminalBoundaryRefusals(node, resourcePlan, preflight));
  return dedupeRefusals(refusals);
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
  resourcePlan?: MoveResourcePlan,
): GenericState["ports"] {
  if (refusals.some((item) => item.resourceClass === "activeTcpConnection")) {
    return [];
  }
  const ports = preflight.tcp
    .filter((tcp) => tcp.state === "0A" && tcp.localHost === "127.0.0.1" && tcp.localPort)
    .map((tcp) => listenerPortState(tcp.localPort!));
  const bespokePort = bespokeIdleListenerPort(resourcePlan);
  if (bespokePort !== undefined && !ports.some((port) => port.port === bespokePort)) {
    ports.push(listenerPortState(bespokePort));
  }
  return ports;
}

function listenerPortState(port: number): GenericState["ports"][number] {
  return {
    protocol: "tcp",
    port,
    bindAddress: "127.0.0.1",
    state: "idle-loopback-listener",
    noActiveClients: true,
  };
}

function isBespokeIdleListener(resourcePlan: MoveResourcePlan): boolean {
  return bespokeIdleListenerPort(resourcePlan) !== undefined;
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
      access: regularFileAccess(resource, file),
      flags: resource?.flags,
      offset: resource?.offset,
      cursor: regularFileCursor(resource, file),
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

function dataDirs(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  preflight: GenericPreflight,
): GenericState["dataDirs"] {
  const dirs = preflight.dataDirs.map((dir) => ({
    path: dir.path,
    access: "write-validated" as const,
    identity: {
      fileCount: dir.fileCount,
      directoryCount: dir.directoryCount,
      totalBytes: dir.totalBytes,
      treeDigest: dir.treeDigest,
    },
  }));
  const httpState = resourcePlan.capture?.httpState;
  if (httpState?.directory && httpState.directoryIdentity) {
    dirs.push({
      path: httpState.directory,
      access: "write-validated",
      identity: httpState.directoryIdentity,
    });
  }
  const hasUnixSocketInCwd = genericUnixSockets(preflight, resourcePlan).some((socket) =>
    socket.path.startsWith(`${node.cwd}/`),
  );
  if (
    node.cwd &&
    preflight.cwd &&
    !hasUnixSocketInCwd &&
    !dirs.some((dir) => dir.path === node.cwd)
  ) {
    dirs.unshift({ path: node.cwd, access: "write-validated", identity: preflight.cwd });
  }
  return dedupeDataDirs(dirs);
}

function dedupeDataDirs(dirs: GenericState["dataDirs"]): GenericState["dataDirs"] {
  const seen = new Set<string>();
  return dirs.filter((dir) => {
    if (seen.has(dir.path)) {
      return false;
    }
    seen.add(dir.path);
    return true;
  });
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

function healthProbe(
  preflight: GenericPreflight,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  migration: GenericState["migration"],
): GenericState["healthProbe"] {
  const unixPath = firstUnixSocketPath(preflight, resourcePlan);
  if (unixPath) {
    return { kind: "unix-connect", path: unixPath };
  }
  const port = listenerPort(preflight) ?? bespokeIdleListenerPort(resourcePlan);
  if (!port || migration?.sourceProofName === "nc-listener") {
    return { kind: "process-alive" };
  }
  return looksLikePythonHttpServer(node.argv)
    ? { kind: "http", url: `http://127.0.0.1:${port}/`, expectedStatus: 200 }
    : { kind: "tcp-connect", host: "127.0.0.1", port };
}

function listenerPort(preflight: GenericPreflight): number | undefined {
  return preflight.tcp.find((tcp) => tcp.state === "0A" && tcp.localHost === "127.0.0.1")
    ?.localPort;
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
signal_stat=$(python3 -c 'import sys; s=open(f"/proc/{sys.argv[1]}/stat", encoding="utf-8").read().rsplit(") ",1)[1].split(); print("%s\t%s" % (s[3], s[2]))' "$pid" 2>/dev/null || printf '\t')
sid=$(printf '%s' "$signal_stat" | cut -f1); pgrp=$(printf '%s' "$signal_stat" | cut -f2)
sigpnd=$(awk '/^SigPnd:/ {print $2}' "$status_file"); shdpnd=$(awk '/^ShdPnd:/ {print $2}' "$status_file")
sigblk=$(awk '/^SigBlk:/ {print $2}' "$status_file"); sigign=$(awk '/^SigIgn:/ {print $2}' "$status_file"); sigcgt=$(awk '/^SigCgt:/ {print $2}' "$status_file")
printf 'SIGNAL_STATE\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$sid" "$pgrp" "$sigpnd" "$shdpnd" "$sigblk" "$sigign" "$sigcgt"
root=$(readlink "/proc/$pid/root" 2>/dev/null || true)
printf 'ROOT\t%s\n' "$root"
awk 'NR > 1 { path = (NF >= 8 ? $8 : ""); printf "UNIX_FD\t-1\t%s\t%s\t%s\t%s\t%s\t%s\t%s\\n", $7, $2, $3, $4, $5, $6, path }' /proc/net/unix 2>/dev/null || true
emit_tree_identity() {
  label="$1"
  path="$2"
  if [ -n "$path" ] && [ -d "$path" ] && [ ! -L "$path" ]; then
    tree_file=/tmp/machinen-generic-tree-$$.txt
    find "$path" -xdev -printf '%P\t%y\t%s\t%m\n' | LC_ALL=C sort >"$tree_file"
    file_count=$(find "$path" -xdev -type f | wc -l | tr -d ' ')
    dir_count=$(find "$path" -xdev -type d | wc -l | tr -d ' ')
    total_bytes=$(find "$path" -xdev -type f -printf '%s\n' | awk '{s += $1} END {print s + 0}')
    digest=$(sha256sum "$tree_file" | cut -d' ' -f1)
    rm -f "$tree_file"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$label" "$path" "$file_count" "$dir_count" "$total_bytes" "$digest"
  fi
}
cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
if [ "$cwd" != "/" ]; then
  emit_tree_identity CWD_IDENTITY "$cwd"
fi
python3 - "$pid" <<'PY' | while IFS= read -r data_dir; do emit_tree_identity DATA_DIR_IDENTITY "$data_dir"; done
import sys
raw = open(f"/proc/{sys.argv[1]}/cmdline", "rb").read().split(b"\0")
argv = [part.decode("utf-8", "ignore") for part in raw if part]
for index, arg in enumerate(argv[:-1]):
    if arg == "--directory" and argv[index + 1].startswith("/"):
        print(argv[index + 1])
PY
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
  eventfd_count=$(awk -F: '/^eventfd-count:/ { gsub(/^[[:space:]]+/, "", $2); print $2; exit }' "/proc/$pid/fdinfo/$fd" 2>/dev/null || true)
  fdinfo_flags=$(awk '/^flags:/ { print $2; exit }' "/proc/$pid/fdinfo/$fd" 2>/dev/null || true)
  if [ -n "$eventfd_count" ]; then printf 'EVENTFD_FD\t%s\t%s\t%s\n' "$fd" "$eventfd_count" "$fdinfo_flags"; fi
  if [ "$target" = "anon_inode:[signalfd]" ]; then sigmask=$(awk '/^sigmask:/ { print $2; exit }' "/proc/$pid/fdinfo/$fd" 2>/dev/null || true); printf 'SIGNALFD_FD\t%s\t%s\t%s\n' "$fd" "$fdinfo_flags" "$sigmask"; fi
  if [ "$target" = "anon_inode:inotify" ] || [ "$target" = "anon_inode:[inotify]" ]; then printf 'INOTIFY_FD\t%s\t%s\n' "$fd" "$fdinfo_flags"; awk -v ifd="$fd" '/^inotify/ { wd=""; mask=""; ignored=""; for (i=1; i<=NF; i++) { if ($i ~ /^wd:/) { split($i,a,":"); wd=a[2] } else if ($i ~ /^mask:/) { split($i,a,":"); mask=a[2] } else if ($i ~ /^ignored_mask:/) { split($i,a,":"); ignored=a[2] } } if (wd != "") printf "INOTIFY_WATCH\t%s\t%s\t%s\t%s\n", ifd, wd, mask, ignored }' "/proc/$pid/fdinfo/$fd" 2>/dev/null || true; fi
  if [ "$target" = "anon_inode:[timerfd]" ]; then awk -v fd="$fd" -v flags="$fdinfo_flags" '
    /^clockid:/ { clockid=$2 }
    /^ticks:/ { ticks=$2 }
    /^settime flags:/ { setflags=$3 }
    /^it_value:/ { value=$0; sub(/^it_value:[[:space:]]*[(]/, "", value); sub(/[)].*/, "", value); gsub(/[[:space:]]+/, "", value); split(value, v, ",") }
    /^it_interval:/ { interval=$0; sub(/^it_interval:[[:space:]]*[(]/, "", interval); sub(/[)].*/, "", interval); gsub(/[[:space:]]+/, "", interval); split(interval, i, ",") }
    END { if (clockid != "") printf "TIMERFD_FD\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", fd, flags, clockid, ticks + 0, setflags + 0, v[1] + 0, v[2] + 0, i[1] + 0, i[2] + 0 }
  ' "/proc/$pid/fdinfo/$fd" 2>/dev/null || true; fi
  if [ "$target" = "anon_inode:[eventpoll]" ] || grep -q '^[[:space:]]*tfd:' "/proc/$pid/fdinfo/$fd" 2>/dev/null; then printf 'EPOLL_FD\t%s\t%s\n' "$fd" "$fdinfo_flags"; awk -v epfd="$fd" '/^[[:space:]]*tfd:/ { tfd=""; events=""; data=""; for (i=1; i<=NF; i++) { if ($i == "tfd:") tfd=$(i+1); else if ($i == "events:") events=$(i+1); else if ($i == "data:") data=$(i+1) } printf "EPOLL_WATCH\t%s\t%s\t%s\t%s\n", epfd, tfd, events, data }' "/proc/$pid/fdinfo/$fd"; fi
  case "$target" in /dev/pts/*|/dev/tty*)
    stat_fields=$(python3 -c 'import sys; s=open(f"/proc/{sys.argv[1]}/stat", encoding="utf-8").read().rsplit(") ",1)[1].split(); print("%s\t%s\t%s\t%s" % (s[2], s[3], s[4], s[5]))' "$pid" 2>/dev/null || printf '\t\t\t')
    pgrp=$(printf '%s' "$stat_fields" | cut -f1); sid=$(printf '%s' "$stat_fields" | cut -f2); tty_nr=$(printf '%s' "$stat_fields" | cut -f3); tpgid=$(printf '%s' "$stat_fields" | cut -f4)
    size=$(stty size -F "$target" 2>/dev/null || true); rows=$(printf '%s' "$size" | awk '{print $1}'); cols=$(printf '%s' "$size" | awk '{print $2}')
    termios=$(stty -a -F "$target" 2>/dev/null | tr '\n\t' '  ' | tr -s ' ' || true); [ -n "$termios" ] || termios=unknown
    printf 'PTY_FD\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$fd" "$target" "$fdinfo_flags" "$sid" "$pgrp" "$tpgid" "$tty_nr" "$rows" "$cols" "$termios"
    ;;
  esac
  awk -v fd="$fd" '/^lock:/ { sub(/^lock:[[:space:]]*/, ""); printf "FILE_LOCK\\tfd=%s %s\\n", fd, $0 }' "/proc/$pid/fdinfo/$fd" 2>/dev/null || true
done
python3 - "$pid" <<'PY' 2>/dev/null || true
import os, sys
pid = sys.argv[1]
def lines(path):
    try: return open(path, "r", encoding="utf-8").read().splitlines()[1:]
    except OSError: return []
fd_by_inode = {}
for fd in os.listdir(f"/proc/{pid}/fd") if os.path.isdir(f"/proc/{pid}/fd") else []:
    if fd.isdigit():
        try: target = os.readlink(f"/proc/{pid}/fd/{fd}")
        except OSError: continue
        if target.startswith("socket:[") and target.endswith("]"):
            fd_by_inode[target[len("socket:["):-1]] = fd
for line in lines("/proc/net/tcp") + lines("/proc/net/tcp6"):
    parts = line.split()
    if len(parts) >= 10 and parts[9] in fd_by_inode:
        print("TCP_FD\t%s\t%s\t%s\t%s\t%s" % (fd_by_inode[parts[9]], parts[9], parts[3], parts[1], parts[2]))
PY
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

export function genericResourceGraphIsPrimary(state: GenericState | undefined): boolean {
  return state?.migration?.mode === "generic-primary" && state.refusalClasses.length === 0;
}

export function genericResourceGraphIsProductPrimary(state: GenericState | undefined): boolean {
  return genericResourceGraphIsPrimary(state) && genericResourceGraphHasProductPath(state);
}

function genericResourceGraphHasProductPath(state: GenericState): boolean {
  const productPath = state.migration?.productPath;
  if (!productPath) {
    return false;
  }
  if (staticHttpTreeIdentityProductPathMarkers.has(productPath.markerProofName)) {
    return (
      (genericProductPathIsPromoted(productPath) ||
        staticHttpTreeIdentityProductPathIsProofSelected(productPath)) &&
      genericResourceGraphHasStaticHttpTreeIdentity(state)
    );
  }
  return genericProductPathIsPromoted(productPath);
}

function genericResourceGraphHasStaticHttpTreeIdentity(state: GenericState): boolean {
  const identity = state.staticRootTreeIdentity;
  if (!identity?.path || !identity.sourceIdentity.treeDigest) {
    return false;
  }
  if (
    !identity.targetVerification.includes("before target launch") ||
    !identity.driftRefusal.includes("data-dir-identity-mismatch")
  ) {
    return false;
  }
  const matchingDir = state.dataDirs.find((dir) => dir.path === identity.path);
  if (matchingDir?.access !== "read-only") {
    return false;
  }
  if (matchingDir.identity.treeDigest !== identity.sourceIdentity.treeDigest) {
    return false;
  }
  return state.resourceClasses.some(
    (resourceClass) =>
      resourceClass.resourceClass === "directoryIdentity" && resourceClass.status === "supported",
  );
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
    ...genericUnixSocketPreflightCommands(state),
    ...genericPipePreflightCommands(state),
    ...genericInotify.genericInotifyPreflightCommands(state),
    ...genericMmap.genericMmapPreflightCommands(state),
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
    genericFileLockLaunchCommand(state) ??
    genericTimerfdLaunchCommand(state) ??
    genericEventfdLaunchCommand(state) ??
    genericInotify.genericInotifyLaunchCommand(state) ??
    genericMmap.genericMmapLaunchCommand(state) ??
    genericPtyLaunchCommand(state) ??
    genericRegularFileCursorLaunchCommand(state) ??
    `${state.argv.map(shellQuote).join(" ")} >"$log" 2>&1 &
pid=$!`
  );
}

function dataDirPreflight(dir: GenericState["dataDirs"][number]): string {
  const path = shellQuote(dir.path);
  const check =
    dir.access === "write-validated"
      ? `test -w ${path} || fail data-dir-not-writable`
      : `test -d ${path} || fail data-dir-missing`;
  const identity = dir.identity
    ? `find ${path} -xdev ! -type f ! -type d -print -quit | grep -q . && fail data-dir-unsupported-entry
tree_file=/tmp/machinen-generic-loader-tree-$$.txt
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
host = sys.argv[1]
port = int(sys.argv[2])
probe = socket.socket()
try:
    probe.settimeout(0.2)
    if probe.connect_ex((host, port)) == 0:
        raise SystemExit(1)
finally:
    probe.close()
s = socket.socket()
try:
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((host, port))
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
