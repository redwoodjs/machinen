import type { MoveDescriptor } from "@machinen/runtime";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];
type GenericResource = MoveResourcePlan["resources"][number];
type GenericRefusalClass = NonNullable<GenericState>["refusalClasses"][number];
type GenericRegularFile = NonNullable<GenericState>["regularFiles"][number];

export type GenericPreflight = {
  uid?: number;
  gid?: number;
  root?: string;
  cwd?: NonNullable<GenericState>["cwd"]["identity"];
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
  dataDirs: Array<{
    path: string;
    fileCount: number;
    directoryCount: number;
    totalBytes: number;
    treeDigest: string;
  }>;
  unix: Array<{
    fd: number;
    inode: string;
    refCount: string;
    protocol: string;
    flags: string;
    type: string;
    state: string;
    path: string;
  }>;
  eventfds: Array<{
    fd: number;
    counter: string;
    fdinfoFlags: string;
  }>;
  epolls: Array<{
    fd: number;
    fdinfoFlags: string;
    watchedFds: Array<{
      targetFd: number;
      events: string;
      data: string;
    }>;
  }>;
  timers: Array<{
    fd: number;
    fdinfoFlags: string;
    clockId: number | "unknown";
    ticks: string;
    settimeFlags: number | "unknown";
    valueSeconds: number;
    valueNanoseconds: number;
    intervalSeconds: number;
    intervalNanoseconds: number;
  }>;
  signal?: {
    sessionId?: number;
    processGroupId?: number;
    pendingMaskHex: string;
    sharedPendingMaskHex: string;
    blockedMaskHex: string;
    ignoredMaskHex: string;
    caughtMaskHex: string;
  };
  signalfds: Array<{
    fd: number;
    fdinfoFlags: string;
    sigmask: string;
  }>;
  inotifies: Array<{
    fd: number;
    fdinfoFlags: string;
    watches: Array<{
      wd: number;
      mask: string;
      ignoredMask: string;
      path?: string;
    }>;
  }>;
  ptys: Array<{
    fd: number;
    path: string;
    fdinfoFlags: string;
    sessionId?: number;
    processGroupId?: number;
    terminalProcessGroupId?: number;
    ttyNumber?: number;
    rows?: number;
    columns?: number;
    termios: string;
  }>;
  locks: string[];
  mmaps: string[];
};

export function createGenericPreflight(): GenericPreflight {
  return {
    files: [],
    tcp: [],
    dataDirs: [],
    unix: [],
    eventfds: [],
    epolls: [],
    timers: [],
    signalfds: [],
    inotifies: [],
    ptys: [],
    locks: [],
    mmaps: [],
  };
}

export function parseWave2PreflightRow(preflight: GenericPreflight, parts: string[]): boolean {
  switch (parts[0]) {
    case "UNIX_FD":
      return parseUnixFd(preflight, parts);
    case "EVENTFD_FD":
      return parseEventfd(preflight, parts);
    case "EPOLL_FD":
      return parseEpoll(preflight, parts);
    case "EPOLL_WATCH":
      return parseEpollWatch(preflight, parts);
    case "TIMERFD_FD":
      return parseTimerfd(preflight, parts);
    case "SIGNAL_STATE":
      return parseSignalState(preflight, parts);
    case "SIGNALFD_FD":
      return parseSignalfd(preflight, parts);
    case "INOTIFY_FD":
      return parseInotify(preflight, parts);
    case "INOTIFY_WATCH":
      return parseInotifyWatch(preflight, parts);
    case "PTY_FD":
      return parsePty(preflight, parts);
    default:
      return false;
  }
}

function parseUnixFd(preflight: GenericPreflight, parts: string[]): boolean {
  const fd = number(parts[1]);
  if (fd === undefined) {
    return true;
  }
  preflight.unix.push({
    fd,
    inode: parts[2] ?? "",
    refCount: parts[3] ?? "",
    protocol: parts[4] ?? "",
    flags: parts[5] ?? "",
    type: parts[6] ?? "",
    state: parts[7] ?? "",
    path: parts[8] ?? "",
  });
  return true;
}

function parseEventfd(preflight: GenericPreflight, parts: string[]): boolean {
  const fd = number(parts[1]);
  if (fd !== undefined) {
    preflight.eventfds.push({ fd, counter: parts[2] ?? "unknown", fdinfoFlags: parts[3] ?? "" });
  }
  return true;
}

function parseEpoll(preflight: GenericPreflight, parts: string[]): boolean {
  const fd = number(parts[1]);
  if (fd !== undefined && !preflight.epolls.some((item) => item.fd === fd)) {
    preflight.epolls.push({ fd, fdinfoFlags: parts[2] ?? "", watchedFds: [] });
  }
  return true;
}

function parseEpollWatch(preflight: GenericPreflight, parts: string[]): boolean {
  const fd = number(parts[1]);
  const targetFd = number(parts[2]);
  if (fd !== undefined && targetFd !== undefined) {
    let epoll = preflight.epolls.find((item) => item.fd === fd);
    if (!epoll) {
      epoll = { fd, fdinfoFlags: "", watchedFds: [] };
      preflight.epolls.push(epoll);
    }
    epoll.watchedFds.push({ targetFd, events: parts[3] ?? "", data: parts[4] ?? "" });
  }
  return true;
}

function parseTimerfd(preflight: GenericPreflight, parts: string[]): boolean {
  const timer = timerfdPreflightDescriptor(parts);
  if (timer) {
    preflight.timers.push(timer);
  }
  return true;
}

function parseInotify(preflight: GenericPreflight, parts: string[]): boolean {
  const fd = number(parts[1]);
  if (fd !== undefined && !preflight.inotifies.some((item) => item.fd === fd)) {
    preflight.inotifies.push({ fd, fdinfoFlags: parts[2] ?? "", watches: [] });
  }
  return true;
}

function parseInotifyWatch(preflight: GenericPreflight, parts: string[]): boolean {
  const fd = number(parts[1]);
  const wd = number(parts[2]);
  if (fd !== undefined && wd !== undefined) {
    let inotify = preflight.inotifies.find((item) => item.fd === fd);
    if (!inotify) {
      inotify = { fd, fdinfoFlags: "", watches: [] };
      preflight.inotifies.push(inotify);
    }
    inotify.watches.push({
      wd,
      mask: parts[3] ?? "",
      ignoredMask: parts[4] ?? "",
      path: parts[5],
    });
  }
  return true;
}

function timerfdPreflightDescriptor(
  parts: string[],
): GenericPreflight["timers"][number] | undefined {
  const fd = number(parts[1]);
  if (fd === undefined) {
    return undefined;
  }
  return {
    fd,
    fdinfoFlags: textOr(parts[2], ""),
    clockId: numberOrUnknown(parts[3]),
    ticks: textOr(parts[4], "unknown"),
    settimeFlags: numberOrUnknown(parts[5]),
    valueSeconds: numberOrZero(parts[6]),
    valueNanoseconds: numberOrZero(parts[7]),
    intervalSeconds: numberOrZero(parts[8]),
    intervalNanoseconds: numberOrZero(parts[9]),
  };
}

function textOr(value: string | undefined, fallback: string): string {
  return value ?? fallback;
}

function numberOrUnknown(value: string | undefined): number | "unknown" {
  return number(value) ?? "unknown";
}

function numberOrZero(value: string | undefined): number {
  return number(value) ?? 0;
}

function parseSignalState(preflight: GenericPreflight, parts: string[]): boolean {
  preflight.signal = {
    sessionId: number(parts[1]),
    processGroupId: number(parts[2]),
    pendingMaskHex: signalMask(parts[3]),
    sharedPendingMaskHex: signalMask(parts[4]),
    blockedMaskHex: signalMask(parts[5]),
    ignoredMaskHex: signalMask(parts[6]),
    caughtMaskHex: signalMask(parts[7]),
  };
  return true;
}

function parseSignalfd(preflight: GenericPreflight, parts: string[]): boolean {
  const fd = number(parts[1]);
  if (fd !== undefined) {
    preflight.signalfds.push({
      fd,
      fdinfoFlags: parts[2] ?? "",
      sigmask: signalMask(parts[3]),
    });
  }
  return true;
}

function signalMask(value: string | undefined): string {
  return /^[0-9a-fA-F]+$/.test(value ?? "") ? value! : "0";
}

function parsePty(preflight: GenericPreflight, parts: string[]): boolean {
  const fd = number(parts[1]);
  if (fd === undefined) {
    return true;
  }
  preflight.ptys.push({
    fd,
    path: parts[2] ?? "",
    fdinfoFlags: parts[3] ?? "",
    sessionId: number(parts[4]),
    processGroupId: number(parts[5]),
    terminalProcessGroupId: number(parts[6]),
    ttyNumber: number(parts[7]),
    rows: number(parts[8]),
    columns: number(parts[9]),
    termios: parts.slice(10).join("\t"),
  });
  return true;
}

export function regularFileAccess(
  resource: GenericResource | undefined,
  file: GenericPreflight["files"][number],
): GenericRegularFile["access"] {
  if (isReadOnlyFileResource(resource)) {
    return "read-only";
  }
  if (hasAppendFlag(resource)) {
    return isAppendOnlyRegularFileResource(resource) && appendCursorAtEnd(resource, file)
      ? "append-only"
      : "append-only-refused";
  }
  return "read-write-refused";
}

export function regularFileCursor(
  resource: GenericResource | undefined,
  file?: GenericPreflight["files"][number],
): GenericRegularFile["cursor"] {
  if (resource?.offset === undefined) {
    return undefined;
  }
  return {
    offset: resource.offset,
    policy:
      hasAppendFlag(resource) &&
      isAppendOnlyRegularFileResource(resource) &&
      file &&
      appendCursorAtEnd(resource, file)
        ? "append-only-end"
        : "read-only-offset",
  };
}

export function genericResourceRefusal(
  resource: GenericResource,
  preflight: GenericPreflight,
  idleLoopbackTcpListener: boolean,
  supportedUnixPathnameListener = false,
  supportedEventfdCounter = false,
  supportedEpollSet = false,
  supportedPtyTranscriptProbe = false,
  supportedTimerfd = false,
  supportedInotifyFileFollow = false,
): GenericRefusalClass[] {
  switch (resource.kind) {
    case "argv":
    case "cwd":
      return [];
    case "file":
      return fileResourceRefusal(resource, preflight);
    case "socket":
      return socketResourceRefusal(
        resource,
        preflight,
        idleLoopbackTcpListener,
        supportedUnixPathnameListener,
      );
    case "pipe":
      return unsupportedResourceClassRefusal("pipe", resource.fd, resource.path);
    case "pty":
      return supportedPtyTranscriptProbe ? [] : ptyResourceRefusal(resource, preflight);
    case "eventfd":
      return supportedEventfdCounter
        ? []
        : unsupportedResourceClassRefusal("eventfd", resource.fd, resource.path);
    case "epoll":
      return supportedEpollSet
        ? []
        : unsupportedResourceClassRefusal("epoll", resource.fd, resource.path);
    case "timer":
      return supportedTimerfd
        ? []
        : unsupportedResourceClassRefusal("timerfd", resource.fd, resource.path);
    case "signalfd":
      return unsupportedResourceClassRefusal("signalfd", resource.fd, resource.path);
    case "unknown":
      return supportedInotifyFileFollow ? [] : unknownResourceRefusal(resource);
    default:
      return deferredResourceClassRefusal(resource.kind, resource.fd, resource.path);
  }
}

function fileResourceRefusal(
  resource: GenericResource,
  preflight: GenericPreflight,
): GenericRefusalClass[] {
  const { fd, path } = resource;
  const file = preflight.files.find((item) => item.fd === fd);
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
  if (!isRegularFilePath(path) || isReadOnlyFileResource(resource)) {
    return [];
  }
  if (!hasAppendFlag(resource)) {
    return [writableFileCursorRefusal(resource)];
  }
  if (isAppendOnlyRegularFileResource(resource) && appendCursorAtEnd(resource, file)) {
    return [];
  }
  return [appendOnlyCursorRefusal(resource, file)];
}

function writableFileCursorRefusal(resource: GenericResource): GenericRefusalClass {
  return refusal(
    "writableRegularFileCursor",
    "regular-file fd is not proven append-only or read-only; generic cursor continuation refuses writable or unknown access",
    `${evidence(resource.fd, resource.path)} flags=${resource.flags?.join(",") ?? "unknown"}`,
  );
}

function appendOnlyCursorRefusal(
  resource: GenericResource,
  file: GenericPreflight["files"][number] | undefined,
): GenericRefusalClass {
  return refusal(
    "appendOnlyRegularFileCursor",
    appendRefusalMessage(resource),
    `${evidence(resource.fd, resource.path)} flags=${resource.flags?.join(",") ?? "unknown"} offset=${resource.offset ?? "unknown"} size=${file?.size ?? "unknown"}`,
  );
}

function socketResourceRefusal(
  resource: GenericResource,
  preflight: GenericPreflight,
  idleLoopbackTcpListener: boolean,
  supportedUnixPathnameListener: boolean,
): GenericRefusalClass[] {
  if (idleLoopbackTcpListener || supportedUnixPathnameListener) {
    return [];
  }
  const unix = preflight.unix.find(
    (item) => item.fd === resource.fd || item.inode === socketInode(resource.path),
  );
  if (!unix) {
    return [
      refusal(
        "socket",
        "socket fd is not a proven idle loopback listener",
        evidence(resource.fd, resource.path),
      ),
    ];
  }
  const shape = unixSocketShape(unix);
  return [
    refusal(
      shape.resourceClass,
      `${shape.label} is not generically supported in the wave 2 baseline`,
      `${evidence(resource.fd, resource.path)} unix=${JSON.stringify(unix)}`,
    ),
  ];
}

function socketInode(path: string | undefined): string | undefined {
  const prefix = "socket:[";
  return path?.startsWith(prefix) && path.endsWith("]") ? path.slice(prefix.length, -1) : undefined;
}

function ptyResourceRefusal(
  resource: GenericResource,
  preflight: GenericPreflight,
): GenericRefusalClass[] {
  const pty = preflight.ptys.find((item) => item.fd === resource.fd || item.path === resource.path);
  return [
    refusal(
      "terminalOrPtyRefusal",
      "PTY/terminal fd requires controlling-terminal, session, foreground-pgrp, termios, winsize, and transcript policy; generic move keeps interactive terminal migration refused",
      ptyRefusalEvidence(resource, pty),
    ),
  ];
}

function ptyRefusalEvidence(
  resource: GenericResource,
  pty: GenericPreflight["ptys"][number] | undefined,
): string {
  const ptyFields = pty ?? emptyPtyEvidence();
  const fields = {
    fd: ptyField(ptyFields.fd, resource.fd),
    path: ptyField(ptyFields.path, resource.path),
    sid: ptyField(ptyFields.sessionId),
    pgrp: ptyField(ptyFields.processGroupId),
    tpgid: ptyField(ptyFields.terminalProcessGroupId),
    tty: ptyField(ptyFields.ttyNumber),
    winsize: `${ptyField(ptyFields.rows)}x${ptyField(ptyFields.columns)}`,
    flags: ptyText(ptyFields.fdinfoFlags, resourceFlags(resource)),
    termios: ptyText(ptyFields.termios, "unavailable-from-preflight"),
  };
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function emptyPtyEvidence(): Partial<GenericPreflight["ptys"][number]> {
  return {};
}

function resourceFlags(resource: GenericResource): string | undefined {
  return resource.flags ? resource.flags.join(",") : undefined;
}

function ptyField(value: string | number | undefined, fallback?: string | number): string | number {
  if (value !== undefined) {
    return value;
  }
  return fallback === undefined ? "unknown" : fallback;
}

function ptyText(value: string | undefined, fallback: string | undefined): string {
  if (value && value.length > 0) {
    return value;
  }
  return fallback && fallback.length > 0 ? fallback : "unknown";
}

function unknownResourceRefusal(resource: GenericResource): GenericRefusalClass[] {
  const path = resource.path ?? "";
  const matches: Array<[string, string, string[]]> = [
    [
      "inotify",
      "inotify state is not generically supported",
      ["anon_inode:inotify", "anon_inode:[inotify]"],
    ],
    [
      "fanotify",
      "fanotify state is not generically supported",
      ["anon_inode:fanotify", "anon_inode:[fanotify]"],
    ],
    ["eventfd", "eventfd state is not generically supported", ["anon_inode:[eventfd]"]],
    [
      "epoll",
      "epoll interest/readiness state is not generically supported",
      ["anon_inode:[eventpoll]"],
    ],
    ["timerfd", "timerfd deadline state is not generically supported", ["anon_inode:[timerfd]"]],
    [
      "signalfd",
      "signalfd pending signal state is not generically supported",
      ["anon_inode:[signalfd]"],
    ],
    ["ioUring", "io_uring state is not generically supported", ["anon_inode:[io_uring]"]],
  ];
  const match = matches.find(([, , needles]) => needles.some((needle) => path.includes(needle)));
  return match
    ? [refusal(match[0], match[1], evidence(resource.fd, resource.path))]
    : path.includes("anon_inode:")
      ? [
          refusal(
            "anonInode",
            "unknown anon-inode state is not generically supported",
            evidence(resource.fd, resource.path),
          ),
        ]
      : unsupportedResourceClassRefusal("unknown", resource.fd, resource.path);
}

function unixSocketShape(unix: GenericPreflight["unix"][number]): {
  resourceClass: string;
  label: string;
} {
  if (unix.path.startsWith("@")) {
    return { resourceClass: "unixSocketAbstract", label: "abstract Unix socket" };
  }
  if (unix.type === "0002") {
    return { resourceClass: "unixSocketDatagram", label: "Unix datagram socket" };
  }
  if (unix.path.startsWith("/") && unix.flags === "00010000") {
    return { resourceClass: "unixSocketPathnameListener", label: "pathname Unix socket listener" };
  }
  if (unix.path.startsWith("/") && unix.state === "03") {
    return { resourceClass: "unixSocketConnected", label: "connected Unix stream socket" };
  }
  return Number.parseInt(unix.refCount, 16) > 1
    ? { resourceClass: "unixSocketPair", label: "Unix socketpair" }
    : { resourceClass: "unixSocketConnected", label: "connected Unix stream socket" };
}

function unsupportedResourceClassRefusal(
  kind: string,
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
      `${kind}`,
      `${kind} resource class is deferred for generic graph move`,
      evidence(fd, path),
      "deferred",
    ),
  ];
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
    nextAction: `add explicit ${resourceClass} resource descriptor and target-native loader proof`,
  };
}

function evidence(fd: number | undefined, path: string | undefined): string {
  return `fd=${fd ?? "unknown"} path=${path ?? "unknown"}`;
}

function isRegularFilePath(path: string | undefined): boolean {
  return Boolean(path && path.startsWith("/") && !path.startsWith("/dev/"));
}

function isReadOnlyFileResource(resource: GenericResource | undefined): boolean {
  const flags = fdFlags(resource);
  return flags !== undefined && (flags & 3) === 0;
}

function isAppendOnlyRegularFileResource(resource: GenericResource | undefined): boolean {
  const flags = fdFlags(resource);
  const appendMask = 0o2000;
  const largeFileMask = 0o100000;
  const noFollowMask = 0o400000;
  return (
    flags !== undefined &&
    (flags & 3) === 1 &&
    (flags & appendMask) !== 0 &&
    (flags & ~(3 | appendMask | largeFileMask | noFollowMask)) === 0
  );
}

function hasAppendFlag(resource: GenericResource | undefined): boolean {
  const flags = fdFlags(resource);
  return flags !== undefined && (flags & 0o2000) !== 0;
}

function appendRefusalMessage(resource: GenericResource): string {
  return isAppendOnlyRegularFileResource(resource)
    ? "append-only regular-file fd must be captured at EOF before generic continuation"
    : "append-only regular-file fd has unsupported access mode or flags";
}

function appendCursorAtEnd(
  resource: GenericResource,
  file: GenericPreflight["files"][number] | undefined,
): boolean {
  return resource.offset !== undefined && file !== undefined && resource.offset === file.size;
}

function fdFlags(resource: GenericResource | undefined): number | undefined {
  const octal = resource?.flags?.find((flag) => flag.startsWith("octal:"))?.slice("octal:".length);
  if (!octal) {
    return undefined;
  }
  const flags = Number.parseInt(octal, 8);
  return Number.isInteger(flags) ? flags : undefined;
}

function number(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= -1 ? parsed : undefined;
}
