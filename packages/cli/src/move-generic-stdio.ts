import type { MoveDescriptor, MovePidGraphNode } from "@machinen/runtime";

import { supportedNoninteractivePtyProbe } from "./move-generic-pty-terminal.ts";
import type { GenericPreflight } from "./move-generic-wave2-baseline.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];
type GenericStdioGraph = NonNullable<NonNullable<GenericState>["stdioGraph"]>;

export function genericStdioGraph(
  resourcePlan: MoveResourcePlan,
  ptySupport = false,
): GenericStdioGraph {
  const fds = ([0, 1, 2] as const).map((fd) => stdioFd(resourcePlan, fd));
  return { policy: stdioGraphPolicy(fds, ptySupport), fds };
}

export function genericStdioPolicy(
  resourcePlan: MoveResourcePlan,
  preflight?: GenericPreflight,
  node?: MovePidGraphNode,
): NonNullable<GenericState>["stdioPolicy"] {
  if (preflight && node && supportedNoninteractivePtyProbe(node, resourcePlan, preflight)) {
    return "stdio-inherited-noninteractive";
  }
  const stdio = resourcePlan.resources.filter((resource) => [0, 1, 2].includes(resource.fd ?? -1));
  return stdio.every((resource) => resource.path === "/dev/null")
    ? "stdio-dev-null-or-closed"
    : "refuse-nontrivial-stdio";
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
  if (/^pipe:\[\d+\]$/.test(path)) {
    return "pipe";
  }
  if (kind === "pty") {
    return "pty";
  }
  return kind === "file" ? "regular-file" : "refused";
}

function stdioGraphPolicy(
  fds: GenericStdioGraph["fds"],
  ptySupport: boolean,
): GenericStdioGraph["policy"] {
  if (fds.every((fd) => fd.target === "closed" || fd.target === "dev-null")) {
    return "dev-null-or-closed";
  }
  if (ptySupport && fds.every((fd) => ["closed", "dev-null", "pty"].includes(fd.target))) {
    return "modeled-pty-transcript";
  }
  if (fds.some((fd) => fd.target === "refused" || fd.target === "pty")) {
    return "refused";
  }
  return fds.some((fd) => fd.target === "pipe") ? "modeled-pipe" : "inherited-noninteractive";
}
