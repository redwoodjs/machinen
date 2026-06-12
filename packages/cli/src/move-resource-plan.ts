import {
  planNativeTargetFdTable,
  type MoveDescriptor,
  type MovePidGraphNode,
  type NativeProcessImageArchitecture,
  type NativeProcessImageRefusal,
  type NativeProcessResource,
} from "@machinen/runtime";
import { basename } from "node:path";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;

type GuestMoveFd = {
  fd: number;
  target: string;
  flags?: string[];
  offset?: number;
  fdinfo?: string[];
};

type GuestMoveNetSocket = {
  inode: string;
  localAddress?: string;
  remoteAddress?: string;
  txQueue?: number;
  rxQueue?: number;
};

type GuestMoveResourceScan = {
  uid?: number;
  gid?: number;
  sourceArch?: NativeProcessImageArchitecture;
  pingGroupRangeStart?: number;
  pingGroupRangeEnd?: number;
  safeBoundary?: { state: "sleep-timer" | "pre-send-icmp" | "refused"; detail: string };
  freeze?: { state: "ptrace-attached" | "refused"; detail: string };
  tasks?: number;
  wchan?: string;
  syscall?: string;
  maps: string[];
  registers?: Record<string, unknown>;
  fds: GuestMoveFd[];
  icmpSockets: GuestMoveNetSocket[];
  rawSockets: GuestMoveNetSocket[];
};

export function parseGuestMoveResourceScan(stdout: string): GuestMoveResourceScan {
  const scan: GuestMoveResourceScan = { maps: [], fds: [], icmpSockets: [], rawSockets: [] };
  const fdMap = new Map<number, GuestMoveFd>();
  for (const row of stdout.split("\n").filter(Boolean)) {
    parseGuestMoveResourceRow(row, scan, fdMap);
  }
  scan.fds = Array.from(fdMap.values()).sort((left, right) => left.fd - right.fd);
  return scan;
}

type GuestMoveResourceRowParser = (
  parts: string[],
  scan: GuestMoveResourceScan,
  fdMap: Map<number, GuestMoveFd>,
) => void;

const GUEST_MOVE_RESOURCE_ROW_PARSERS: Record<string, GuestMoveResourceRowParser> = {
  STATUS: parseGuestStatusRow,
  UNAME: parseGuestUnameRow,
  PING_RANGE: parseGuestPingRangeRow,
  FD: parseGuestFdRow,
  FDINFO: parseGuestFdInfoRow,
  MAP: parseGuestMapRow,
  TASKS: parseGuestTasksRow,
  WCHAN: parseGuestWchanRow,
  SYSCALL: parseGuestSyscallRow,
  SAFE_BOUNDARY: parseGuestSafeBoundaryRow,
  FREEZE: parseGuestFreezeRow,
  REG_ARM64: parseGuestArm64RegistersRow,
  REG_AMD64: parseGuestAmd64RegistersRow,
  NET_ICMP: parseGuestIcmpSocketRow,
  NET_RAW: parseGuestRawSocketRow,
};

function parseGuestMoveResourceRow(
  row: string,
  scan: GuestMoveResourceScan,
  fdMap: Map<number, GuestMoveFd>,
): void {
  const parts = row.split("\t");
  GUEST_MOVE_RESOURCE_ROW_PARSERS[parts[0] ?? ""]?.(parts, scan, fdMap);
}

function parseGuestStatusRow(parts: string[], scan: GuestMoveResourceScan): void {
  scan.uid = parseOptionalNonNegativeInteger(parts[1] ?? "");
  scan.gid = parseOptionalNonNegativeInteger(parts[2] ?? "");
}

function parseGuestUnameRow(parts: string[], scan: GuestMoveResourceScan): void {
  scan.sourceArch = nativeArchFromUname(parts[1] ?? "");
}

function parseGuestPingRangeRow(parts: string[], scan: GuestMoveResourceScan): void {
  scan.pingGroupRangeStart = parseOptionalNonNegativeInteger(parts[1] ?? "");
  scan.pingGroupRangeEnd = parseOptionalNonNegativeInteger(parts[2] ?? "");
}

function parseGuestFdRow(
  parts: string[],
  _scan: GuestMoveResourceScan,
  fdMap: Map<number, GuestMoveFd>,
): void {
  upsertGuestFd(fdMap, parts[1] ?? "", parts[2] ?? "");
}

function parseGuestFdInfoRow(
  parts: string[],
  _scan: GuestMoveResourceScan,
  fdMap: Map<number, GuestMoveFd>,
): void {
  updateGuestFdInfo(fdMap, parts[1] ?? "", parts.slice(2).join("\t"));
}

function parseGuestMapRow(parts: string[], scan: GuestMoveResourceScan): void {
  scan.maps.push(parts.slice(1).join("\t"));
}

function parseGuestTasksRow(parts: string[], scan: GuestMoveResourceScan): void {
  scan.tasks = parseOptionalNonNegativeInteger(parts[1] ?? "");
}

function parseGuestWchanRow(parts: string[], scan: GuestMoveResourceScan): void {
  scan.wchan = parts.slice(1).join("\t");
}

function parseGuestSyscallRow(parts: string[], scan: GuestMoveResourceScan): void {
  scan.syscall = parts.slice(1).join("\t");
}

function parseGuestSafeBoundaryRow(parts: string[], scan: GuestMoveResourceScan): void {
  const state = parts[1] === "sleep-timer" || parts[1] === "pre-send-icmp" ? parts[1] : "refused";
  scan.safeBoundary = { state, detail: parts.slice(2).join("\t") };
}

function parseGuestFreezeRow(parts: string[], scan: GuestMoveResourceScan): void {
  const state = parts[1] === "ptrace-attached" ? "ptrace-attached" : "refused";
  scan.freeze = { state, detail: parts.slice(2).join("\t") };
}

function parseGuestArm64RegistersRow(parts: string[], scan: GuestMoveResourceScan): void {
  if (parts[1] === "refused") {
    return;
  }
  scan.registers = {
    arch: "arm64",
    pc: parts[1] ?? "0x0",
    sp: parts[2] ?? "0x0",
    pstate: parts[3] ?? "0x0",
    x: parts.slice(4, 35),
  };
}

function parseGuestAmd64RegistersRow(parts: string[], scan: GuestMoveResourceScan): void {
  if (parts[1] === "refused") {
    return;
  }
  const names = [
    "rip",
    "rsp",
    "rflags",
    "rax",
    "rbx",
    "rcx",
    "rdx",
    "rsi",
    "rdi",
    "rbp",
    "r8",
    "r9",
    "r10",
    "r11",
    "r12",
    "r13",
    "r14",
    "r15",
    "fsBase",
    "gsBase",
  ];
  scan.registers = { arch: "amd64" };
  for (const [index, name] of names.entries()) {
    scan.registers[name] = parts[index + 1] ?? "0x0";
  }
}

function parseGuestIcmpSocketRow(parts: string[], scan: GuestMoveResourceScan): void {
  pushGuestNetSocket(scan.icmpSockets, parts[1] ?? "");
}

function parseGuestRawSocketRow(parts: string[], scan: GuestMoveResourceScan): void {
  pushGuestNetSocket(scan.rawSockets, parts[1] ?? "");
}

function pushGuestNetSocket(sockets: GuestMoveNetSocket[], line: string): void {
  const socket = parseGuestNetSocket(line);
  if (socket) {
    sockets.push(socket);
  }
}

function upsertGuestFd(fdMap: Map<number, GuestMoveFd>, fdText: string, target: string): void {
  const fd = parseOptionalNonNegativeInteger(fdText);
  if (fd === undefined) {
    return;
  }
  fdMap.set(fd, { ...fdMap.get(fd), fd, target });
}

function updateGuestFdInfo(fdMap: Map<number, GuestMoveFd>, fdText: string, line: string): void {
  const fd = parseOptionalNonNegativeInteger(fdText);
  if (fd === undefined) {
    return;
  }
  const current = fdMap.get(fd) ?? { fd, target: "" };
  const fdinfo = [...(current.fdinfo ?? []), line];
  const [, key = "", value = ""] = line.match(/^(pos|flags):\s*(\S+)/) ?? [];
  if (key === "pos") {
    fdMap.set(fd, { ...current, fdinfo, offset: parseOptionalNonNegativeInteger(value) });
  } else if (key === "flags") {
    fdMap.set(fd, { ...current, fdinfo, flags: [`octal:${value}`] });
  } else {
    fdMap.set(fd, { ...current, fdinfo });
  }
}

function parseGuestNetSocket(line: string): GuestMoveNetSocket | undefined {
  const fields = line.trim().split(/\s+/);
  if (fields[0] === "sl" || fields.length < 10) {
    return undefined;
  }
  const [txQueue, rxQueue] = parseQueuePair(fields[4]);
  return {
    inode: fields[9]!,
    localAddress: fields[1],
    remoteAddress: fields[2],
    txQueue,
    rxQueue,
  };
}

function parseQueuePair(value: string | undefined): [number | undefined, number | undefined] {
  const [tx, rx] = (value ?? "").split(":");
  return [parseOptionalHexInteger(tx ?? ""), parseOptionalHexInteger(rx ?? "")];
}

export function buildMoveResourcePlan(
  node: MovePidGraphNode,
  scan: GuestMoveResourceScan,
): MoveResourcePlan {
  const resources = buildMoveResources(node, scan);
  const plan = planNativeTargetFdTable({
    resources,
    expectedFds: scan.fds.map((fd) => fd.fd),
    inheritedStdio: { mode: "inherit-output" },
  });
  return {
    kind: "machinen.move.resource-plan",
    source: "guest-procfs",
    sourceArch: scan.sourceArch,
    resources: plan.resources,
    fdTableEntries: plan.entries,
    targetGuestResources: plan.targetGuestResources,
    refusals: [...plan.refusals, ...nativeCaptureRefusals(scan)],
    acceptedSubsets: acceptedMoveResourceSubsets(plan.entries),
    capture: moveNativeCapture(scan),
  };
}

function nativeCaptureRefusals(scan: GuestMoveResourceScan): NativeProcessImageRefusal[] {
  const refusals: NativeProcessImageRefusal[] = [];
  if (scan.safeBoundary?.state !== "sleep-timer") {
    refusals.push({
      code: "active-syscall",
      message: "move capture did not reach the ping sleep/timer safe boundary",
      detail: { kind: "thread", boundary: scan.safeBoundary?.detail ?? "missing" },
    });
  }
  if (scan.freeze?.state !== "ptrace-attached") {
    refusals.push({
      code: "thread-state-unsupported",
      message: "move capture did not freeze the process with ptrace",
      detail: { kind: "thread", freeze: scan.freeze?.detail ?? "missing" },
    });
  }
  return refusals;
}

function moveNativeCapture(scan: GuestMoveResourceScan): MoveResourcePlan["capture"] {
  return {
    safeBoundary: scan.safeBoundary,
    freeze: scan.freeze,
    tasks: scan.tasks,
    wchan: scan.wchan,
    syscall: scan.syscall,
    maps: scan.maps,
    registers: scan.registers,
  };
}

function buildMoveResources(
  node: MovePidGraphNode,
  scan: GuestMoveResourceScan,
): NativeProcessResource[] {
  return [
    { id: `pid:${node.pid}:argv`, kind: "argv", state: "captured", recipe: { argv: node.argv } },
    ...(node.cwd
      ? [
          {
            id: `pid:${node.pid}:cwd`,
            kind: "cwd" as const,
            state: "captured" as const,
            path: node.cwd,
            recipe: { cwd: node.cwd },
          },
        ]
      : []),
    ...scan.fds.map((fd) => moveResourceFromGuestFd(node, scan, fd)),
  ];
}

function moveResourceFromGuestFd(
  node: MovePidGraphNode,
  scan: GuestMoveResourceScan,
  fd: GuestMoveFd,
): NativeProcessResource {
  const socketInode = socketInodeFromFdTarget(fd.target);
  if (socketInode) {
    return socketMoveResource(node, scan, fd, socketInode);
  }
  return nonSocketMoveResource(node.pid, fd);
}

function nonSocketMoveResource(pid: number, fd: GuestMoveFd): NativeProcessResource {
  const base = nativeResourceBase(pid, fd);
  if (fd.target.startsWith("pipe:[")) {
    return { ...base, kind: "pipe", path: fd.target };
  }
  if (/^\/dev\/(pts|tty)/.test(fd.target)) {
    return { ...base, kind: "pty", path: fd.target };
  }
  const anonKind = anonInodeResourceKind(fd.target);
  if (anonKind) {
    return { ...base, kind: anonKind, path: fd.target, recipe: anonInodeRecipe(fd, anonKind) };
  }
  if (fd.target.startsWith("/")) {
    return { ...base, kind: "file", path: fd.target, offset: fd.offset };
  }
  return { ...base, kind: "unknown", path: fd.target };
}

function anonInodeResourceKind(
  target: string,
): Extract<NativeProcessResource["kind"], "eventfd" | "epoll" | "timer" | "signalfd"> | undefined {
  const kinds: Record<
    string,
    Extract<NativeProcessResource["kind"], "eventfd" | "epoll" | "timer" | "signalfd">
  > = {
    "anon_inode:[eventfd]": "eventfd",
    "anon_inode:[eventpoll]": "epoll",
    "anon_inode:[timerfd]": "timer",
    "anon_inode:[signalfd]": "signalfd",
  };
  return kinds[target];
}

function anonInodeRecipe(
  fd: GuestMoveFd,
  kind: Extract<NativeProcessResource["kind"], "eventfd" | "epoll" | "timer" | "signalfd">,
): Record<string, unknown> | undefined {
  if (kind === "eventfd") {
    return {
      eventfdCounter: fdinfoValue(fd, "eventfd-count") ?? "unknown",
      eventfdSemaphore: fdinfoValue(fd, "eventfd-semaphore"),
      fdinfoFlags: fdinfoValue(fd, "flags"),
    };
  }
  if (kind === "epoll") {
    return {
      fdinfoFlags: fdinfoValue(fd, "flags"),
      epollWatchedFds: (fd.fdinfo ?? []).flatMap(epollWatchFromFdinfo),
    };
  }
  return undefined;
}

function fdinfoValue(fd: GuestMoveFd, key: string): string | undefined {
  const prefix = `${key}:`;
  return fd.fdinfo
    ?.find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
}

function epollWatchFromFdinfo(
  line: string,
): Array<{ targetFd: number; events: string; data: string }> {
  const parts = line.trim().replaceAll(":", ": ").split(/\s+/);
  if (parts[0] !== "tfd:") {
    return [];
  }
  const targetFd = parseOptionalNonNegativeInteger(afterToken(parts, "tfd:"));
  if (targetFd === undefined) {
    return [];
  }
  return [
    {
      targetFd,
      events: afterToken(parts, "events:") ?? "",
      data: afterToken(parts, "data:") ?? "",
    },
  ];
}

function afterToken(parts: string[], token: string): string | undefined {
  const index = parts.indexOf(token);
  return index >= 0 ? parts[index + 1] : undefined;
}

function socketMoveResource(
  node: MovePidGraphNode,
  scan: GuestMoveResourceScan,
  fd: GuestMoveFd,
  inode: string,
): NativeProcessResource {
  const icmpSocket = scan.icmpSockets.find((socket) => socket.inode === inode);
  if (icmpSocket) {
    return {
      ...nativeResourceBase(node.pid, fd, `socket:${inode}:icmp`),
      kind: "socket",
      path: fd.target,
      recipe: pingSocketRecipe(node, scan, icmpSocket),
    };
  }
  const rawSocket = scan.rawSockets.find((socket) => socket.inode === inode);
  if (rawSocket) {
    return {
      ...nativeResourceBase(node.pid, fd, `socket:${inode}:raw-icmp`),
      kind: "raw-socket",
      path: fd.target,
      recipe: rawIcmpRecipe(node, rawSocket),
    };
  }
  return {
    ...nativeResourceBase(node.pid, fd, `socket:${inode}`),
    kind: "socket",
    path: fd.target,
  };
}

function nativeResourceBase(
  pid: number,
  fd: GuestMoveFd,
  idSuffix = `fd:${fd.fd}`,
): Pick<NativeProcessResource, "id" | "state" | "fd" | "flags"> {
  return { id: `pid:${pid}:${idSuffix}`, state: "captured", fd: fd.fd, flags: fd.flags };
}

function pingSocketRecipe(
  node: MovePidGraphNode,
  scan: GuestMoveResourceScan,
  socket: GuestMoveNetSocket,
): Record<string, unknown> | undefined {
  const identifier = parseProcNetPort(socket.localAddress);
  const destination = moveIcmpDestination(node, socket);
  if (!destination || !socketQueuesEmpty(socket) || identifier === undefined) {
    return undefined;
  }
  return {
    pingSocketModel: destination === "127.0.0.1" ? "loopback-echo-v1" : "external-target-egress-v1",
    family: "inet4",
    socketType: "dgram",
    protocol: "icmp",
    destination,
    credentialPolicy: "target-ping-group-range",
    uid: scan.uid,
    gid: scan.gid,
    pingGroupRangeStart: scan.pingGroupRangeStart,
    pingGroupRangeEnd: scan.pingGroupRangeEnd,
    networkNamespace: destination === "127.0.0.1" ? "target-loopback" : "target-network",
    route: destination === "127.0.0.1" ? "loopback" : "target-egress",
    identifier,
    inFlightPackets: "none",
    receiveQueue: "empty",
  };
}

// fallow-ignore-next-line code-duplication
function rawIcmpRecipe(
  node: MovePidGraphNode,
  socket: GuestMoveNetSocket,
): Record<string, unknown> | undefined {
  const identifier = parseProcNetPort(socket.localAddress);
  const destination = moveIcmpDestination(node, socket);
  if (!destination || !socketQueuesEmpty(socket) || identifier === undefined) {
    return undefined;
  }
  return {
    rawIcmpModel: destination === "127.0.0.1" ? "loopback-echo-v1" : "external-target-egress-v1",
    family: "inet4",
    socketType: "raw",
    protocol: "icmp",
    destination,
    capability: "cap-net-raw",
    networkNamespace: destination === "127.0.0.1" ? "target-loopback" : "target-network",
    route: destination === "127.0.0.1" ? "loopback" : "target-egress",
    identifier,
    inFlightPackets: "none",
    receiveQueue: "empty",
  };
}

function moveIcmpDestination(
  node: MovePidGraphNode,
  socket: GuestMoveNetSocket,
): string | undefined {
  const remote = procNetAddressHost(socket.remoteAddress);
  const argvDestination = movePingDestination(node.argv);
  if (remote === "127.0.0.1") {
    return argvDestination === "127.0.0.1" ? remote : undefined;
  }
  return remote;
}

function movePingDestination(argv: string[]): string | undefined {
  let destination: string | undefined;
  for (const arg of argv) {
    if (!arg.startsWith("-") && basename(arg) !== "ping") {
      destination = arg;
    }
  }
  return destination === "localhost" ? "127.0.0.1" : destination;
}

function socketQueuesEmpty(socket: GuestMoveNetSocket): boolean {
  return socket.txQueue === 0 && socket.rxQueue === 0;
}

function socketInodeFromFdTarget(target: string): string | undefined {
  return target.match(/^socket:\[(\d+)\]$/)?.[1];
}

function parseProcNetPort(value: string | undefined): number | undefined {
  const port = value?.split(":")[1];
  return port ? parseOptionalHexInteger(port) : undefined;
}

function procNetAddressHost(value: string | undefined): string | undefined {
  const address = value?.split(":")[0];
  if (!address || address.length !== 8) {
    return undefined;
  }
  const bytes = address
    .match(/../g)
    ?.reverse()
    .map((byte) => Number.parseInt(byte, 16));
  return bytes?.every((byte) => Number.isInteger(byte)) ? bytes.join(".") : undefined;
}

function acceptedMoveResourceSubsets(
  entries: ReturnType<typeof planNativeTargetFdTable>["entries"],
): string[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "synthetic-ping-socket") {
      return [
        entry.recipe?.pingSocketModel === "external-target-egress-v1"
          ? "external-ping-socket-v1:no-inflight-target-egress"
          : "ping-socket-v1:loopback-echo-no-inflight",
      ];
    }
    if (entry.kind === "synthetic-raw-icmp") {
      return [
        entry.recipe?.rawIcmpModel === "external-target-egress-v1"
          ? "external-raw-icmp-v1:no-inflight-target-egress"
          : "raw-icmp-v1:loopback-echo-no-inflight",
      ];
    }
    return [];
  });
}

function nativeArchFromUname(value: string): NativeProcessImageArchitecture | undefined {
  if (value === "aarch64" || value === "arm64") {
    return "arm64";
  }
  if (value === "x86_64" || value === "amd64") {
    return "amd64";
  }
  return undefined;
}

function parseOptionalNonNegativeInteger(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseOptionalHexInteger(value: string): number | undefined {
  const parsed = Number.parseInt(value, 16);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}
