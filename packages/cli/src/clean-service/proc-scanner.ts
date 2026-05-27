type CleanServiceKernelDecisionKind = "supported" | "irrelevant" | "refused";

interface CleanServiceKernelDecision {
  kind: CleanServiceKernelDecisionKind;
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

interface FdInspectionInput {
  fd: number;
  link: string;
  flagsOctal?: string;
  appRoot: string;
  declaredImmutableInputs?: string[];
}

interface TcpRow {
  localPort: number;
  state: string;
  inode: string;
}

interface UnixSocketRow {
  type: string;
  state: string;
  inode: string;
  path?: string;
}

interface MemoryMapRow {
  path?: string;
  permissions: string;
}

interface MountInfoRow {
  mountPoint: string;
  fsType: string;
  options: string[];
  optionalFields: string[];
}

interface ProcessStatInfo {
  pid: number;
  ppid: number;
  pgrp: number;
  session: number;
}

interface ElfStaticInspection {
  validElf: boolean;
  hasProgramInterpreter: boolean;
  elfType?: number;
  machine?: number;
}

export function inspectFd(input: FdInspectionInput): CleanServiceKernelDecision {
  if (input.fd <= 2) {
    return {
      kind: "irrelevant",
      code: "clean-service-stdio-fd-irrelevant",
      message: "stdio descriptors are not part of clean-service continuation state",
      detail: { fd: input.fd, link: input.link },
    };
  }
  if (input.link.endsWith(" (deleted)")) {
    return {
      kind: "refused",
      code: "clean-service-deleted-open-file-unsupported",
      message: "deleted-but-open files are not portable clean-service state",
      detail: { fd: input.fd, link: input.link },
    };
  }
  if (input.link.startsWith("pipe:[") || input.link.startsWith("fifo:[")) {
    return {
      kind: "refused",
      code: "clean-service-open-fd-unsupported",
      message: "pipes and FIFOs require an explicit clean-service descriptor model",
      detail: { fd: input.fd, link: input.link },
    };
  }
  if (input.link.startsWith("socket:[")) {
    return {
      kind: "supported",
      code: "clean-service-socket-fd-modeled",
      message: "socket fd will be evaluated by kernel socket table inspection",
      detail: { fd: input.fd, link: input.link },
    };
  }
  if (input.link === "anon_inode:[eventpoll]") {
    return {
      kind: "supported",
      code: "clean-service-epoll-recreated-by-runtime-start",
      message: "epoll fd is accepted only when watched descriptors are otherwise modeled",
      detail: { fd: input.fd },
    };
  }
  if (input.link === "anon_inode:[eventfd]") {
    return {
      kind: "supported",
      code: "clean-service-eventfd-recreated-by-runtime-start",
      message:
        "eventfd is accepted as runtime startup state when no cross-restore value is required",
      detail: { fd: input.fd },
    };
  }
  if (input.link === "anon_inode:[timerfd]") {
    return {
      kind: "refused",
      code: "clean-service-timerfd-state-unsupported",
      message: "timerfd deadlines are not replayed by clean-service restore",
      detail: { fd: input.fd },
    };
  }
  if (input.link === "anon_inode:[signalfd]") {
    return {
      kind: "refused",
      code: "clean-service-signalfd-state-unsupported",
      message: "signalfd and pending signal state are not modeled by clean-service restore",
      detail: { fd: input.fd },
    };
  }
  if (isAbsolutePath(input.link)) {
    if (isPathInside(input.link, input.appRoot)) {
      return {
        kind: "supported",
        code: "clean-service-app-root-fd-captured",
        message: "open file is inside the captured app root",
        detail: { fd: input.fd, path: input.link },
      };
    }
    if (input.declaredImmutableInputs?.some((root) => isPathInside(input.link, root))) {
      return {
        kind: "supported",
        code: "clean-service-immutable-input-fd-captured",
        message: "open file outside app root is covered by declared immutable input provenance",
        detail: { fd: input.fd, path: input.link },
      };
    }
    return {
      kind: "refused",
      code: "clean-service-open-fd-unsupported",
      message: "open regular file outside the captured app root is not portable without provenance",
      detail: { fd: input.fd, path: input.link },
    };
  }
  return {
    kind: "refused",
    code: "clean-service-open-fd-unsupported",
    message: "open descriptor is not part of the clean-service model",
    detail: { fd: input.fd, link: input.link },
  };
}

export function inspectTcpRows(
  rows: TcpRow[],
  socketInodes: Set<string>,
  expectedListenPorts: Set<number>,
): CleanServiceKernelDecision[] {
  const decisions: CleanServiceKernelDecision[] = [];
  for (const row of rows) {
    if (!socketInodes.has(row.inode)) {
      continue;
    }
    if (row.state === "0A") {
      decisions.push(
        expectedListenPorts.has(row.localPort)
          ? {
              kind: "supported",
              code: "clean-service-listener-rebound",
              message: "expected listener socket will be rebound by target-native service start",
              detail: { port: row.localPort, inode: row.inode },
            }
          : {
              kind: "refused",
              code: "clean-service-unexpected-listener-unsupported",
              message: "listening socket is not declared by the clean-service verifier model",
              detail: { port: row.localPort, inode: row.inode },
            },
      );
    } else {
      decisions.push({
        kind: "refused",
        code: "clean-service-active-session-unsupported",
        message: `active TCP state ${tcpStateName(row.state)} is not portable clean-service state`,
        detail: { port: row.localPort, state: row.state, inode: row.inode },
      });
    }
  }
  return decisions;
}

export function inspectUnixSockets(
  rows: UnixSocketRow[],
  socketInodes: Set<string>,
  modeledPaths: Set<string> = new Set(),
): CleanServiceKernelDecision[] {
  return rows
    .filter((row) => socketInodes.has(row.inode))
    .map((row) =>
      row.path && modeledPaths.has(row.path)
        ? {
            kind: "supported",
            code: "clean-service-unix-socket-rebound",
            message: "modeled Unix socket can be rebound by target-native service start",
            detail: { path: row.path, inode: row.inode },
          }
        : {
            kind: "refused",
            code: "clean-service-unix-socket-unsupported",
            message: "Unix sockets require an explicit clean-service descriptor model",
            detail: { path: row.path, inode: row.inode },
          },
    );
}

export function inspectMemoryMaps(
  rows: MemoryMapRow[],
  appRoot: string,
): CleanServiceKernelDecision[] {
  const decisions: CleanServiceKernelDecision[] = [];
  for (const row of rows) {
    if (!row.path) {
      continue;
    }
    if (row.permissions[1] === "w" && row.permissions[3] === "s") {
      decisions.push({
        kind: "refused",
        code: "clean-service-shared-memory-unsupported",
        message: "writable shared mappings are not modeled by clean-service restore",
        detail: { path: row.path, permissions: row.permissions },
      });
    }
    if (isDurableStatePath(row.path)) {
      decisions.push({
        kind: "refused",
        code: "clean-service-mmapped-durable-state-unsupported",
        message: "mmapped database or WAL files require a service-specific logical capture path",
        detail: { path: row.path, permissions: row.permissions },
      });
    }
    if (isNativeExtensionPath(row.path) && isPathInside(row.path, appRoot)) {
      decisions.push({
        kind: "refused",
        code: "clean-service-native-extension-state-unsupported",
        message: "native extensions loaded from the app root are not portable clean-service state",
        detail: { path: row.path },
      });
    }
    if (isRuntimeLibraryPath(row.path)) {
      decisions.push({
        kind: "supported",
        code: "clean-service-runtime-library-from-target-policy",
        message: "runtime shared library is supplied by target runtime policy",
        detail: { path: row.path },
      });
    }
  }
  return decisions;
}

export function inspectProcessTopology(
  primary: ProcessStatInfo,
  all: ProcessStatInfo[],
): CleanServiceKernelDecision[] {
  const children = all.filter((proc) => proc.ppid === primary.pid);
  const sharedGroup = all.filter((proc) => proc.pid !== primary.pid && proc.pgrp === primary.pgrp);
  const decisions: CleanServiceKernelDecision[] = [
    {
      kind: "supported",
      code: "clean-service-single-primary-process",
      message: "primary service process is the clean-service continuation boundary",
      detail: { pid: primary.pid, pgrp: primary.pgrp, session: primary.session },
    },
  ];
  if (children.length > 0) {
    decisions.push({
      kind: "refused",
      code: "clean-service-process-topology-unsupported",
      message: "child workers require an explicit clean-service process-group model",
      detail: { childPids: children.map((child) => child.pid) },
    });
  }
  if (sharedGroup.length > 0) {
    decisions.push({
      kind: "refused",
      code: "clean-service-process-topology-unsupported",
      message: "shared process groups require an explicit clean-service process-group model",
      detail: { peerPids: sharedGroup.map((peer) => peer.pid) },
    });
  }
  return decisions;
}

export function inspectMountState(
  appRoot: string,
  mounts: MountInfoRow[],
): CleanServiceKernelDecision[] {
  const mount = deepestMountForPath(appRoot, mounts);
  if (!mount) {
    return [];
  }
  if (mount.mountPoint === "/mnt" || mount.mountPoint.startsWith("/mnt/")) {
    return [
      mount.options.includes("ro")
        ? {
            kind: "supported",
            code: "clean-service-readonly-host-mount-provenance-required",
            message: "read-only host mount can be accepted only with immutable file provenance",
            detail: { mountPoint: mount.mountPoint, fsType: mount.fsType },
          }
        : {
            kind: "refused",
            code: "clean-service-mount-state-ambiguous",
            message: "writable host-mounted app state is ambiguous clean-service input",
            detail: { mountPoint: mount.mountPoint, fsType: mount.fsType },
          },
    ];
  }
  return [
    {
      kind: "supported",
      code: "clean-service-guest-filesystem-root-captured",
      message: "app root is on the captured guest filesystem",
      detail: { mountPoint: mount.mountPoint, fsType: mount.fsType },
    },
  ];
}

// fallow-ignore-next-line code-duplication
export function parseTcpTable(text: string): TcpRow[] {
  return text
    .trim()
    .split(/\n/u)
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter((cols) => cols.length > 9)
    .map((cols) => ({
      localPort: Number.parseInt(cols[1]!.split(":")[1]!, 16),
      state: cols[3]!,
      inode: cols[9]!,
    }));
}

// fallow-ignore-next-line code-duplication
export function parseUnixSocketTable(text: string): UnixSocketRow[] {
  return text
    .trim()
    .split(/\n/u)
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter((cols) => cols.length >= 7)
    .map((cols) => ({
      type: cols[4]!,
      state: cols[5]!,
      inode: cols[6]!,
      path: cols[7],
    }));
}

export function parseMaps(text: string): MemoryMapRow[] {
  return text
    .trim()
    .split(/\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter((cols) => cols.length >= 2)
    .map((cols) => ({ permissions: cols[1]!, path: cols.slice(5).join(" ") || undefined }));
}

export function parseMountInfo(text: string): MountInfoRow[] {
  return text
    .trim()
    .split(/\n/u)
    .map((line) => {
      const parts = line.trim().split(/\s+/u);
      const sep = parts.indexOf("-");
      return {
        mountPoint: unescapeMountPath(parts[4] ?? "/"),
        options: (parts[5] ?? "").split(","),
        optionalFields: sep > 6 ? parts.slice(6, sep) : [],
        fsType: sep >= 0 ? (parts[sep + 1] ?? "unknown") : "unknown",
      };
    });
}

export function parseProcessStat(text: string): ProcessStatInfo | undefined {
  const end = text.lastIndexOf(")");
  const pid = Number(text.slice(0, text.indexOf(" ")));
  if (!Number.isFinite(pid) || end < 0) {
    return undefined;
  }
  const rest = text
    .slice(end + 2)
    .trim()
    .split(/\s+/u);
  return {
    pid,
    ppid: Number(rest[1]),
    pgrp: Number(rest[2]),
    session: Number(rest[3]),
  };
}

export function inspectElfStatic(buffer: Buffer): ElfStaticInspection {
  if (
    buffer.length < 64 ||
    buffer[0] !== 0x7f ||
    buffer[1] !== 0x45 ||
    buffer[2] !== 0x4c ||
    buffer[3] !== 0x46
  ) {
    return { validElf: false, hasProgramInterpreter: false };
  }
  const is64 = buffer[4] === 2;
  const little = buffer[5] === 1;
  const readUInt16 = (offset: number) =>
    little ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  const readUInt32 = (offset: number) =>
    little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  const readUInt64 = (offset: number) =>
    Number(little ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset));
  const elfType = readUInt16(16);
  const machine = readUInt16(18);
  const phoff = is64 ? readUInt64(32) : readUInt32(28);
  const phentsize = readUInt16(is64 ? 54 : 42);
  const phnum = readUInt16(is64 ? 56 : 44);
  let hasProgramInterpreter = false;
  for (let index = 0; index < phnum; index += 1) {
    const offset = phoff + index * phentsize;
    if (offset + 4 > buffer.length) {
      break;
    }
    if (readUInt32(offset) === 3) {
      hasProgramInterpreter = true;
      break;
    }
  }
  return { validElf: true, hasProgramInterpreter, elfType, machine };
}

export function summarizeKernelDecisions(
  decisions: CleanServiceKernelDecision[],
): Record<CleanServiceKernelDecisionKind, number> {
  return {
    supported: decisions.filter((decision) => decision.kind === "supported").length,
    irrelevant: decisions.filter((decision) => decision.kind === "irrelevant").length,
    refused: decisions.filter((decision) => decision.kind === "refused").length,
  };
}

export function firstRefusal(
  decisions: CleanServiceKernelDecision[],
): CleanServiceKernelDecision | undefined {
  return decisions.find((decision) => decision.kind === "refused");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

function isPathInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root.replace(/\/+$/u, "")}/`);
}

function tcpStateName(state: string): string {
  return state === "01" ? "ESTABLISHED" : state === "08" ? "CLOSE_WAIT" : state;
}

function isDurableStatePath(path: string): boolean {
  return /(?:^|\/)(?:pg_wal|wal|sqlite|sqlite-wal|ib_logfile|mysql|mariadb|\.db|.*\.sqlite3?)(?:$|\.|\/)/iu.test(
    path,
  );
}

function isNativeExtensionPath(path: string): boolean {
  return /\.(?:node|so|pyd)$/u.test(path);
}

function isRuntimeLibraryPath(path: string): boolean {
  return path.startsWith("/lib/") || path.startsWith("/usr/lib/") || path.startsWith("/lib64/");
}

function deepestMountForPath(path: string, mounts: MountInfoRow[]): MountInfoRow | undefined {
  return mounts
    .filter((mount) => isPathInside(path, mount.mountPoint) || path === mount.mountPoint)
    .sort((a, b) => b.mountPoint.length - a.mountPoint.length)[0];
}

function unescapeMountPath(path: string): string {
  return path.replaceAll("\\040", " ").replaceAll("\\011", "\t").replaceAll("\\012", "\n");
}
