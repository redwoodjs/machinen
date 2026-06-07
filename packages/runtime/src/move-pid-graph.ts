import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { basename, join } from "node:path";

export const MOVE_PID_GRAPH_KIND = "machinen.move.guest-pid-dependency-graph" as const;

export type MovePidGraphObservationConsistency = "live-procfs" | "paused-vm-atomic";
export type MovePidGraphDecision = "accepted" | "refused" | "inaccessible";

export interface MovePidGraphCaptureOptions {
  pid: number;
  procRoot?: string;
  observationConsistency?: MovePidGraphObservationConsistency;
}

export interface MovePidGraphProcess {
  pid: number;
  ppid: number | null;
  name: string | null;
  state: string | null;
  tracerPid: number;
  threadsDeclared: number;
  exe: string | null;
  cwd: string | null;
  argv: string[];
  envPolicy: "names-only";
  envNames: string[];
  namespaces: Record<string, string>;
}

export interface MovePidGraphThread {
  tid: number;
  name: string | null;
  state: string | null;
  syscall: MovePidGraphSyscall | null;
  wchan: string | null;
}

export interface MovePidGraphSyscall {
  raw: string;
  state: "inside-syscall" | "outside-syscall" | "unknown";
  number: number | null;
  args: string[];
}

export interface MovePidGraphFd {
  fd: number;
  target: string | null;
  kind: "file" | "socket" | "pipe" | "pty" | "anon" | "unknown";
  flags: string | null;
  pos: number | null;
  inode: string | null;
  anonKind: string | null;
  metadata: Record<string, string>;
  dependencyId: string;
}

export interface MovePidGraphSocket {
  inode: string;
  table: "tcp" | "tcp6" | "udp" | "udp6" | "raw" | "raw6" | "icmp" | "icmp6" | "unix";
  local: string | null;
  remote: string | null;
  state: string | null;
  txQueueBytes: number;
  rxQueueBytes: number;
  protocol: "tcp" | "udp" | "raw" | "raw-icmp" | "ping-dgram-icmp" | "unix" | "unknown";
}

export interface MovePidGraphDependency {
  id: string;
  kind: "process" | "thread" | "fd" | "socket" | "pipe" | "pty" | "file" | "namespace";
  ownedByPid: boolean;
  reason: string;
}

export interface MovePidGraphRefusal {
  code: string;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface MovePidGraphAdapterCandidate {
  adapter: string;
  confidence: "detected" | "candidate";
  reason: string;
}

export interface MovePidDependencyGraph {
  kind: typeof MOVE_PID_GRAPH_KIND;
  version: 1;
  pid: number;
  observation: {
    source: "guest-agent-procfs";
    consistency: MovePidGraphObservationConsistency;
    procRoot: string;
  };
  process: MovePidGraphProcess | null;
  threads: MovePidGraphThread[];
  fds: MovePidGraphFd[];
  sockets: MovePidGraphSocket[];
  dependencies: MovePidGraphDependency[];
  refusals: MovePidGraphRefusal[];
  adapterCandidates: MovePidGraphAdapterCandidate[];
  decision: MovePidGraphDecision;
}

export interface MovePidGraphClassification {
  decision: MovePidGraphDecision;
  shapeId: string;
  reason: string;
  graph: MovePidDependencyGraph;
}

export function captureMovePidDependencyGraph(
  options: MovePidGraphCaptureOptions,
): MovePidDependencyGraph {
  const procRoot = options.procRoot ?? "/proc";
  const pidDir = join(procRoot, String(options.pid));
  const baseGraph = newMovePidGraph(options, procRoot);
  if (!existsSync(pidDir)) {
    baseGraph.refusals.push({ code: "process-not-visible", message: "process is not visible" });
    baseGraph.decision = "inaccessible";
    return baseGraph;
  }

  const status = readText(join(pidDir, "status"));
  if (status === null) {
    baseGraph.refusals.push({
      code: "procfs-status-inaccessible",
      message: "cannot read process status",
    });
    baseGraph.decision = "inaccessible";
    return baseGraph;
  }

  const process = readMovePidProcess(options.pid, pidDir, status);
  const threads = readMovePidThreads(options.pid, pidDir);
  const fds = readMovePidFds(options.pid, pidDir);
  const sockets = readMovePidSockets(pidDir, fds);
  const dependencies = buildMovePidDependencies(options.pid, process, threads, fds, sockets);
  const refusals = buildMovePidRefusals(process, threads, fds, sockets);
  const adapterCandidates = buildMovePidAdapterCandidates(process, fds, sockets, refusals);

  return {
    ...baseGraph,
    process,
    threads,
    fds,
    sockets,
    dependencies,
    refusals,
    adapterCandidates,
    decision: refusals.length > 0 ? "refused" : "accepted",
  };
}

export function classifyMovePidDependencyGraph(
  graph: MovePidDependencyGraph,
): MovePidGraphClassification {
  if (graph.decision === "inaccessible") {
    return {
      decision: "inaccessible",
      shapeId: "refuse-procfs-inaccessible",
      reason: graph.refusals[0]?.message ?? "process graph is inaccessible",
      graph,
    };
  }
  if (graph.refusals.length > 0) {
    return {
      decision: "refused",
      shapeId: graph.refusals[0]?.code ?? "refuse-untranslated-dependency-graph",
      reason: graph.refusals[0]?.message ?? "dependency graph has unsupported state",
      graph,
    };
  }
  const adapter = graph.adapterCandidates.find((candidate) => candidate.confidence === "detected");
  if (!adapter) {
    return {
      decision: "refused",
      shapeId:
        graph.adapterCandidates.length > 0
          ? "no-proven-process-translator"
          : "no-translator-adapter",
      reason:
        graph.adapterCandidates.length > 0
          ? "resource translators were detected, but no proven process translator owns the full graph"
          : "no proven translator owns the complete dependency graph",
      graph,
    };
  }
  return {
    decision: "accepted",
    shapeId: `shape-${adapter.adapter}`,
    reason: adapter.reason,
    graph,
  };
}

function newMovePidGraph(
  options: MovePidGraphCaptureOptions,
  procRoot: string,
): MovePidDependencyGraph {
  return {
    kind: MOVE_PID_GRAPH_KIND,
    version: 1,
    pid: options.pid,
    observation: {
      source: "guest-agent-procfs",
      consistency: options.observationConsistency ?? "live-procfs",
      procRoot,
    },
    process: null,
    threads: [],
    fds: [],
    sockets: [],
    dependencies: [],
    refusals: [],
    adapterCandidates: [],
    decision: "refused",
  };
}

function readMovePidProcess(pid: number, pidDir: string, status: string): MovePidGraphProcess {
  const envNames = splitNul(readText(join(pidDir, "environ"))).map(
    (entry) => entry.split("=", 1)[0],
  );
  return {
    pid,
    ppid: numberField(status, "PPid"),
    name: textField(status, "Name"),
    state: textField(status, "State"),
    tracerPid: numberField(status, "TracerPid") ?? 0,
    threadsDeclared: numberField(status, "Threads") ?? 0,
    exe: readLink(join(pidDir, "exe")),
    cwd: readLink(join(pidDir, "cwd")),
    argv: splitNul(readText(join(pidDir, "cmdline"))),
    envPolicy: "names-only",
    envNames,
    namespaces: readNamespaces(pidDir),
  };
}

function readMovePidThreads(pid: number, pidDir: string): MovePidGraphThread[] {
  const taskDir = join(pidDir, "task");
  const tids = numericEntries(taskDir);
  return (tids.length > 0 ? tids : [pid]).map((tid) => {
    const taskPath = join(taskDir, String(tid));
    const status = readText(join(taskPath, "status"));
    return {
      tid,
      name: status ? textField(status, "Name") : null,
      state: status ? textField(status, "State") : null,
      syscall: parseSyscall(readText(join(taskPath, "syscall"))),
      wchan: readText(join(taskPath, "wchan"))?.trim() || null,
    };
  });
}

function readMovePidFds(pid: number, pidDir: string): MovePidGraphFd[] {
  return numericEntries(join(pidDir, "fd")).map((fd) => {
    const target = readLink(join(pidDir, "fd", String(fd)));
    const fdinfo = readText(join(pidDir, "fdinfo", String(fd)));
    const metadata = fdinfoFields(fdinfo);
    const kind = fdKind(target);
    const inode = targetInode(target);
    return {
      fd,
      target,
      kind,
      flags: metadata.flags ?? null,
      pos: metadata.pos ? Number.parseInt(metadata.pos, 10) : null,
      inode,
      anonKind: anonKind(target),
      metadata,
      dependencyId: `${kind}:${inode ?? `${pid}:${fd}`}`,
    };
  });
}

function readMovePidSockets(pidDir: string, fds: MovePidGraphFd[]): MovePidGraphSocket[] {
  const socketInodes = new Set(
    fds.filter((fd) => fd.kind === "socket" && fd.inode).map((fd) => fd.inode as string),
  );
  const netDir = join(pidDir, "net");
  return [
    ...parseInetSocketTable(readText(join(netDir, "tcp")), "tcp"),
    ...parseInetSocketTable(readText(join(netDir, "tcp6")), "tcp6"),
    ...parseInetSocketTable(readText(join(netDir, "udp")), "udp"),
    ...parseInetSocketTable(readText(join(netDir, "udp6")), "udp6"),
    ...parseInetSocketTable(readText(join(netDir, "raw")), "raw"),
    ...parseInetSocketTable(readText(join(netDir, "raw6")), "raw6"),
    ...parseInetSocketTable(readText(join(netDir, "icmp")), "icmp"),
    ...parseInetSocketTable(readText(join(netDir, "icmp6")), "icmp6"),
    ...parseUnixSocketTable(readText(join(netDir, "unix"))),
  ].filter((socket) => socketInodes.has(socket.inode));
}

function parseInetSocketTable(
  text: string | null,
  table: MovePidGraphSocket["table"],
): MovePidGraphSocket[] {
  if (!text) {
    return [];
  }
  return socketTableRows(text, 10)
    .map((cols) => {
      const queues = parseQueues(cols[4]);
      const protocol = socketProtocol(table, cols);
      return {
        inode: cols[9] ?? "",
        table,
        local: cols[1] ?? null,
        remote: cols[2] ?? null,
        state: cols[3] ?? null,
        txQueueBytes: queues.tx,
        rxQueueBytes: queues.rx,
        protocol,
      };
    })
    .filter((socket) => socket.inode.length > 0);
}

function parseUnixSocketTable(text: string | null): MovePidGraphSocket[] {
  if (!text) {
    return [];
  }
  return socketTableRows(text, 7)
    .map((cols) => ({
      inode: cols[6] ?? "",
      table: "unix" as const,
      local: cols[7] ?? null,
      remote: null,
      state: cols[4] ?? null,
      txQueueBytes: 0,
      rxQueueBytes: 0,
      protocol: "unix" as const,
    }))
    .filter((socket) => socket.inode.length > 0);
}

function socketTableRows(text: string, minColumns: number): string[][] {
  const rows: string[][] = [];
  const lines = text.trim().split(/\n+/);
  for (let index = 1; index < lines.length; index += 1) {
    const columns = (lines[index] ?? "").trim().split(/\s+/);
    if (columns.length >= minColumns) {
      rows.push(columns);
    }
  }
  return rows;
}

function buildMovePidDependencies(
  pid: number,
  process: MovePidGraphProcess,
  threads: MovePidGraphThread[],
  fds: MovePidGraphFd[],
  sockets: MovePidGraphSocket[],
): MovePidGraphDependency[] {
  const socketInodes = new Set(sockets.map((socket) => socket.inode));
  return [
    { id: `process:${pid}`, kind: "process", ownedByPid: true, reason: "root process" },
    ...Object.entries(process.namespaces).map(([name, target]) => ({
      id: `namespace:${name}:${target}`,
      kind: "namespace" as const,
      ownedByPid: false,
      reason: "namespace membership constrains materialization",
    })),
    ...threads.map((thread) => ({
      id: `thread:${thread.tid}`,
      kind: "thread" as const,
      ownedByPid: true,
      reason: "thread state constrains safe-point translation",
    })),
    ...fds.map((fd) => ({
      id: `fd:${fd.fd}`,
      kind: fdDependencyKind(fd, socketInodes),
      ownedByPid: true,
      reason: `${fd.kind} fd is reachable from root pid`,
    })),
  ];
}

function buildMovePidRefusals(
  process: MovePidGraphProcess,
  threads: MovePidGraphThread[],
  fds: MovePidGraphFd[],
  sockets: MovePidGraphSocket[],
): MovePidGraphRefusal[] {
  return [
    ...processRefusals(process),
    ...threadRefusals(threads),
    ...socketRefusals(sockets),
    ...fdRefusals(fds),
  ];
}

function processRefusals(process: MovePidGraphProcess): MovePidGraphRefusal[] {
  const rows: MovePidGraphRefusal[] = [];
  if (process.tracerPid > 0) {
    rows.push(
      refusal("ptrace-owned-process", "process already has a tracer", {
        tracerPid: process.tracerPid,
      }),
    );
  }
  for (const path of [process.exe, process.cwd]) {
    if (path?.endsWith(" (deleted)")) {
      rows.push(
        refusal("deleted-path-dependency", "process has a deleted exe/cwd dependency", { path }),
      );
    }
  }
  return rows;
}

function threadRefusals(threads: MovePidGraphThread[]): MovePidGraphRefusal[] {
  return threads
    .filter((thread) => thread.state?.startsWith("R"))
    .map((thread) =>
      refusal("active-thread", "thread is runnable, not parked at a safe point", {
        tid: thread.tid,
        state: thread.state,
      }),
    );
}

function socketRefusals(sockets: MovePidGraphSocket[]): MovePidGraphRefusal[] {
  return sockets.flatMap((socket) => [
    ...socketQueueRefusals(socket),
    ...socketProtocolRefusals(socket),
  ]);
}

function socketQueueRefusals(socket: MovePidGraphSocket): MovePidGraphRefusal[] {
  if (socket.rxQueueBytes === 0 && socket.txQueueBytes === 0) {
    return [];
  }
  return [
    refusal("socket-queued-bytes", "socket has queued bytes that are not yet translated", {
      inode: socket.inode,
      table: socket.table,
      rxQueueBytes: socket.rxQueueBytes,
      txQueueBytes: socket.txQueueBytes,
    }),
  ];
}

function socketProtocolRefusals(socket: MovePidGraphSocket): MovePidGraphRefusal[] {
  if (socket.protocol === "raw") {
    return [
      refusal(
        "raw-socket-protocol-untranslated",
        "raw socket protocol is not a proven ICMP translator shape",
        { inode: socket.inode, local: socket.local, remote: socket.remote },
      ),
    ];
  }
  if ((socket.table === "tcp" || socket.table === "tcp6") && socket.state !== "0A") {
    return [
      refusal(
        "tcp-connected-peer-untranslated",
        "connected TCP peer dependency is not translated by the generic graph yet",
        { inode: socket.inode, local: socket.local, remote: socket.remote, state: socket.state },
      ),
    ];
  }
  return [];
}

function fdRefusals(fds: MovePidGraphFd[]): MovePidGraphRefusal[] {
  return fds.flatMap((fd) => [
    ...fdQueueRefusals(fd),
    ...anonFdRefusals(fd),
    ...unknownFdRefusals(fd),
  ]);
}

function fdQueueRefusals(fd: MovePidGraphFd): MovePidGraphRefusal[] {
  if (fd.kind !== "pipe" && fd.kind !== "pty") {
    return [];
  }
  return [
    refusal(
      `${fd.kind}-queue-state-unobserved`,
      `${fd.kind} queue state needs an in-guest ioctl observation before translation`,
      { fd: fd.fd, target: fd.target },
    ),
  ];
}

function anonFdRefusals(fd: MovePidGraphFd): MovePidGraphRefusal[] {
  return [
    ...epollFdRefusals(fd),
    ...eventfdRefusals(fd),
    ...timerfdRefusals(fd),
    ...otherAnonFdRefusals(fd),
  ];
}

function epollFdRefusals(fd: MovePidGraphFd): MovePidGraphRefusal[] {
  return fd.anonKind === "eventpoll"
    ? [
        refusal(
          "epoll-interest-graph-untranslated",
          "epoll interest lists need dependency expansion before translation",
          fdEvidence(fd),
        ),
      ]
    : [];
}

function eventfdRefusals(fd: MovePidGraphFd): MovePidGraphRefusal[] {
  return fd.anonKind === "eventfd" && fd.metadata["eventfd-count"] === undefined
    ? [
        refusal(
          "eventfd-counter-unobserved",
          "eventfd counter is not visible in fdinfo",
          fdEvidence(fd),
        ),
      ]
    : [];
}

function timerfdRefusals(fd: MovePidGraphFd): MovePidGraphRefusal[] {
  if (fd.anonKind !== "timerfd") {
    return [];
  }
  if (fd.metadata.ticks === undefined) {
    return [
      refusal(
        "timerfd-expiration-state-unobserved",
        "timerfd expiration state is not visible in fdinfo",
        fdEvidence(fd),
      ),
    ];
  }
  if (Number.parseInt(fd.metadata.ticks, 10) > 0) {
    return [
      refusal(
        "timerfd-readable-expiration-untranslated",
        "readable timerfd expirations must be drained or modeled before translation",
        { ...fdEvidence(fd), ticks: fd.metadata.ticks },
      ),
    ];
  }
  return [];
}

function otherAnonFdRefusals(fd: MovePidGraphFd): MovePidGraphRefusal[] {
  return fd.kind === "anon" && !["eventfd", "timerfd"].includes(fd.anonKind ?? "")
    ? [
        refusal(
          "anon-fd-untranslated",
          "anonymous fd kind is not translated by the generic graph",
          fdEvidence(fd),
        ),
      ]
    : [];
}

function unknownFdRefusals(fd: MovePidGraphFd): MovePidGraphRefusal[] {
  return fd.kind === "unknown"
    ? [refusal("unknown-fd", "fd target is not classified", fdEvidence(fd))]
    : [];
}

function refusal(
  code: string,
  message: string,
  evidence?: Record<string, unknown>,
): MovePidGraphRefusal {
  return { code, message, evidence };
}

function fdEvidence(fd: MovePidGraphFd): Record<string, unknown> {
  return { fd: fd.fd, target: fd.target, anonKind: fd.anonKind };
}

function buildMovePidAdapterCandidates(
  process: MovePidGraphProcess,
  fds: MovePidGraphFd[],
  sockets: MovePidGraphSocket[],
  refusals: MovePidGraphRefusal[],
): MovePidGraphAdapterCandidate[] {
  if (refusals.length > 0) {
    return [];
  }
  return [
    ...pingSocketCandidates(process, sockets),
    ...socketResourceCandidates(sockets),
    ...anonFdResourceCandidates(fds),
  ];
}

function pingSocketCandidates(
  process: MovePidGraphProcess,
  sockets: MovePidGraphSocket[],
): MovePidGraphAdapterCandidate[] {
  const socketProtocols = new Set(sockets.map((socket) => socket.protocol));
  if (!socketProtocols.has("ping-dgram-icmp") && !socketProtocols.has("raw-icmp")) {
    return [];
  }
  const exeName = process.exe ? basename(process.exe.replace(/ \(deleted\)$/, "")) : "";
  return [
    {
      adapter: "ping-socket",
      confidence: "detected",
      reason: `${exeName || "process"} owns an empty ICMP socket dependency`,
    },
  ];
}

function socketResourceCandidates(sockets: MovePidGraphSocket[]): MovePidGraphAdapterCandidate[] {
  return [
    sockets.some(isTcpListenerSocket)
      ? candidate("tcp-listener-empty-queue", "TCP listener dependency has empty queues")
      : null,
    sockets.some((socket) => socket.protocol === "udp")
      ? candidate("udp-bound-empty-queue", "UDP socket dependency has empty queues")
      : null,
    sockets.some((socket) => socket.protocol === "unix")
      ? candidate("unix-socket-empty-queue", "Unix socket dependency has empty queues")
      : null,
  ].filter((row): row is MovePidGraphAdapterCandidate => row !== null);
}

function anonFdResourceCandidates(fds: MovePidGraphFd[]): MovePidGraphAdapterCandidate[] {
  return [
    fds.some((fd) => fd.anonKind === "eventfd")
      ? candidate("eventfd-counter-descriptor", "eventfd counter is visible in fdinfo")
      : null,
    fds.some((fd) => fd.anonKind === "timerfd")
      ? candidate("timerfd-descriptor", "timerfd expiration state is visible in fdinfo")
      : null,
  ].filter((row): row is MovePidGraphAdapterCandidate => row !== null);
}

function candidate(adapter: string, reason: string): MovePidGraphAdapterCandidate {
  return { adapter, confidence: "candidate", reason };
}

function isTcpListenerSocket(socket: MovePidGraphSocket): boolean {
  return (socket.table === "tcp" || socket.table === "tcp6") && socket.state === "0A";
}

function fdDependencyKind(
  fd: MovePidGraphFd,
  socketInodes: Set<string>,
): MovePidGraphDependency["kind"] {
  if (fd.kind === "socket" && fd.inode && socketInodes.has(fd.inode)) {
    return "socket";
  }
  if (fd.kind === "pipe") {
    return "pipe";
  }
  if (fd.kind === "pty") {
    return "pty";
  }
  if (fd.kind === "file") {
    return "file";
  }
  return "fd";
}

const SOCKET_PROTOCOL_BY_TABLE: Partial<
  Record<MovePidGraphSocket["table"], MovePidGraphSocket["protocol"]>
> = {
  tcp: "tcp",
  tcp6: "tcp",
  udp: "udp",
  udp6: "udp",
  icmp: "ping-dgram-icmp",
  icmp6: "ping-dgram-icmp",
  unix: "unix",
};

function socketProtocol(
  table: MovePidGraphSocket["table"],
  cols: string[],
): MovePidGraphSocket["protocol"] {
  if (table === "raw" || table === "raw6") {
    return rawSocketProtocol(cols);
  }
  return SOCKET_PROTOCOL_BY_TABLE[table] ?? "unknown";
}

function rawSocketProtocol(cols: string[]): MovePidGraphSocket["protocol"] {
  const proto = cols[1]?.split(":").at(-1)?.toLowerCase();
  return proto === "0001" || proto === "1" ? "raw-icmp" : "raw";
}

function parseQueues(value: string | undefined): { tx: number; rx: number } {
  const [txHex, rxHex] = (value ?? "0:0").split(":");
  return { tx: parseInt(txHex ?? "0", 16) || 0, rx: parseInt(rxHex ?? "0", 16) || 0 };
}

function parseSyscall(text: string | null): MovePidGraphSyscall | null {
  if (!text) {
    return null;
  }
  const raw = text.trim();
  if (raw === "running") {
    return { raw, state: "outside-syscall", number: null, args: [] };
  }
  const cols = raw.split(/\s+/);
  const number = Number(cols[0]);
  return {
    raw,
    state: Number.isFinite(number) && number >= 0 ? "inside-syscall" : "unknown",
    number: Number.isFinite(number) && number >= 0 ? number : null,
    args: cols.slice(1),
  };
}

function readNamespaces(pidDir: string): Record<string, string> {
  const nsDir = join(pidDir, "ns");
  const namespaces: Record<string, string> = {};
  for (const name of stringEntries(nsDir)) {
    const target = readLink(join(nsDir, name));
    if (target) {
      namespaces[name] = target;
    }
  }
  return namespaces;
}

function fdKind(target: string | null): MovePidGraphFd["kind"] {
  if (!target) {
    return "unknown";
  }
  if (target.startsWith("socket:")) {
    return "socket";
  }
  if (target.startsWith("pipe:")) {
    return "pipe";
  }
  if (target.includes("/dev/pts/") || target === "/dev/ptmx") {
    return "pty";
  }
  if (target.startsWith("anon_inode:")) {
    return "anon";
  }
  if (target.startsWith("/") || target.startsWith(".")) {
    return "file";
  }
  return "unknown";
}

function targetInode(target: string | null): string | null {
  return /\[(\d+)\]/.exec(target ?? "")?.[1] ?? null;
}

function anonKind(target: string | null): string | null {
  const match = /^anon_inode:\[?([^\]]+)\]?$/.exec(target ?? "");
  return match?.[1] ?? null;
}

function fdinfoFields(text: string | null): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of (text ?? "").split(/\n+/)) {
    const match = /^(.*?):\s*(.*?)\s*$/.exec(line);
    if (match?.[1]) {
      fields[match[1]] = match[2] ?? "";
    }
  }
  return fields;
}

function textField(text: string, field: string): string | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}:\\s*(.+)$`, "m").exec(text)?.[1]?.trim() ?? null;
}

function numberField(text: string, field: string): number | null {
  const value = textField(text, field);
  if (value === null) {
    return null;
  }
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function splitNul(text: string | null): string[] {
  return (text ?? "").split("\0").filter((value) => value.length > 0);
}

function numericEntries(path: string): number[] {
  return stringEntries(path)
    .filter((entry) => /^\d+$/.test(entry))
    .map((entry) => Number(entry))
    .sort((a, b) => a - b);
}

function stringEntries(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readLink(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}
