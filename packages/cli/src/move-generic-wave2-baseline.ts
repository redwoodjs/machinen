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
  locks: string[];
  mmaps: string[];
};

export function createGenericPreflight(): GenericPreflight {
  return { files: [], tcp: [], unix: [], locks: [], mmaps: [] };
}

export function parseWave2PreflightRow(preflight: GenericPreflight, parts: string[]): boolean {
  if (parts[0] !== "UNIX_FD") {
    return false;
  }
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
): GenericRefusalClass[] {
  switch (resource.kind) {
    case "argv":
    case "cwd":
      return [];
    case "file":
      return fileResourceRefusal(resource, preflight);
    case "socket":
      return socketResourceRefusal(resource, preflight, idleLoopbackTcpListener);
    case "pipe":
      return unsupportedResourceClassRefusal("pipe", resource.fd, resource.path);
    case "pty":
      return unsupportedResourceClassRefusal("pty", resource.fd, resource.path);
    case "eventfd":
      return unsupportedResourceClassRefusal("eventfd", resource.fd, resource.path);
    case "epoll":
      return unsupportedResourceClassRefusal("epoll", resource.fd, resource.path);
    case "timer":
      return unsupportedResourceClassRefusal("timerfd", resource.fd, resource.path);
    case "signalfd":
      return unsupportedResourceClassRefusal("signalfd", resource.fd, resource.path);
    case "unknown":
      return unknownResourceRefusal(resource);
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
  return hasAppendFlag(resource)
    ? isAppendOnlyRegularFileResource(resource) && appendCursorAtEnd(resource, file)
      ? []
      : [
          refusal(
            "appendOnlyRegularFileCursor",
            appendRefusalMessage(resource),
            `${evidence(fd, path)} flags=${resource.flags?.join(",") ?? "unknown"} offset=${resource.offset ?? "unknown"} size=${file?.size ?? "unknown"}`,
          ),
        ]
    : [
        refusal(
          "writableRegularFileCursor",
          "regular-file fd is not proven append-only or read-only; generic cursor continuation refuses writable or unknown access",
          `${evidence(fd, path)} flags=${resource.flags?.join(",") ?? "unknown"}`,
        ),
      ];
}

function socketResourceRefusal(
  resource: GenericResource,
  preflight: GenericPreflight,
  idleLoopbackTcpListener: boolean,
): GenericRefusalClass[] {
  if (idleLoopbackTcpListener) {
    return [];
  }
  const unix = preflight.unix.find((item) => item.fd === resource.fd);
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
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
