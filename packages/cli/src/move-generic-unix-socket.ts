import type { MoveDescriptor } from "@machinen/runtime";

import type { GenericPreflight } from "./move-generic-wave2-baseline.ts";
import { shellQuote } from "./move-preflight-helpers.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];
type GenericResource = MoveResourcePlan["resources"][number];

type UnixRow = GenericPreflight["unix"][number];

export function genericUnixSockets(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): NonNullable<GenericState>["unixSockets"] {
  return resourcePlan.resources.flatMap((resource) => {
    const unix = unixForResource(preflight, resource);
    return unix && isPathnameListener(unix) && noConnectedUnixStreams(preflight)
      ? [
          {
            fd: resource.fd,
            path: unix.path,
            inode: unix.inode,
            state: "idle-pathname-listener" as const,
            noActiveClients: true as const,
            preflight: {
              targetPathPolicy: "must-not-exist" as const,
              parentDirectoryPolicy: "must-exist-writable" as const,
            },
          },
        ]
      : [];
  });
}

export function supportedUnixPathnameListener(
  preflight: GenericPreflight,
  resource: GenericResource,
): boolean {
  const unix = unixForResource(preflight, resource);
  return Boolean(unix && isPathnameListener(unix) && noConnectedUnixStreams(preflight));
}

export function firstUnixSocketPath(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): string | undefined {
  return genericUnixSockets(preflight, resourcePlan)[0]?.path;
}

export function genericUnixSocketPreflightCommands(state: GenericState): string[] {
  return (state?.unixSockets ?? []).map((socket) => {
    const path = shellQuote(socket.path);
    const parent = shellQuote(parentDir(socket.path));
    return `test ! -e ${path} || fail unix-socket-path-occupied
test -d ${parent} || fail unix-socket-parent-missing
python3 - ${parent} <<'PY' || fail unix-socket-parent-not-writable
import os, stat, sys
mode = stat.S_IMODE(os.stat(sys.argv[1]).st_mode)
sys.exit(0 if mode & 0o222 else 1)
PY`;
  });
}

function unixForResource(
  preflight: GenericPreflight,
  resource: GenericResource,
): UnixRow | undefined {
  const inode = socketInode(resource.path);
  return preflight.unix.find((item) => item.fd === resource.fd || item.inode === inode);
}

function isPathnameListener(unix: UnixRow): boolean {
  return unix.path.startsWith("/") && unix.flags === "00010000" && unix.type === "0001";
}

function noConnectedUnixStreams(preflight: GenericPreflight): boolean {
  return !preflight.unix.some((unix) => unix.state === "03");
}

function socketInode(path: string | undefined): string | undefined {
  const prefix = "socket:[";
  return path?.startsWith(prefix) && path.endsWith("]") ? path.slice(prefix.length, -1) : undefined;
}

function parentDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}
