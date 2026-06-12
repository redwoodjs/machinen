import type { MoveDescriptor, MovePidGraphNode } from "@machinen/runtime";

import type { GenericPreflight } from "./move-generic-wave2-baseline.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];

type GenericPty = NonNullable<NonNullable<GenericState>["ptys"]>[number];

const PTY_PROBE_MARKER = "--machinen-pty-transcript-probe" as const;

export function genericPtys(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
  node: MovePidGraphNode,
): GenericPty[] {
  const supported = supportedNoninteractivePtyProbe(node, resourcePlan, preflight);
  const modeled: GenericPty[] = preflight.ptys.map((pty) => ({
    fd: pty.fd,
    path: pty.path,
    fdinfoFlags: pty.fdinfoFlags,
    sessionId: pty.sessionId,
    processGroupId: pty.processGroupId,
    terminalProcessGroupId: pty.terminalProcessGroupId,
    ttyNumber: pty.ttyNumber,
    winsize:
      pty.rows !== undefined && pty.columns !== undefined
        ? { rows: pty.rows, columns: pty.columns }
        : undefined,
    termios: pty.termios,
    transcriptProbe: supported
      ? { policy: "target-native-reexec-capture-output", marker: PTY_PROBE_MARKER }
      : undefined,
    support: supported
      ? "target-native-noninteractive-transcript-probe"
      : "refused-interactive-terminal-boundary",
  }));
  const seen = new Set(modeled.map((pty) => `${pty.fd}:${pty.path}`));
  for (const resource of resourcePlan.resources) {
    if (resource.kind !== "pty" || resource.fd === undefined) {
      continue;
    }
    const key = `${resource.fd}:${resource.path ?? "unknown"}`;
    if (!seen.has(key)) {
      modeled.push({
        fd: resource.fd,
        path: resource.path ?? "unknown",
        fdinfoFlags: resource.flags?.join(","),
        termios: "unavailable-from-preflight; refused interactive PTY boundary",
        support: "refused-interactive-terminal-boundary",
      });
      seen.add(key);
    }
  }
  return modeled;
}

export function supportedNoninteractivePtyProbe(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  preflight: GenericPreflight,
): boolean {
  return (
    resourcePlan.resources.some((resource) => resource.kind === "pty") &&
    !resourcePlan.resources.some((resource) => resource.fd === 0 && resource.kind === "pty") &&
    node.argv.includes(PTY_PROBE_MARKER) &&
    preflight.ptys.length > 0 &&
    preflight.ptys.every(hasReplayablePtyEvidence)
  );
}

function hasReplayablePtyEvidence(pty: GenericPreflight["ptys"][number]): boolean {
  return (
    pty.rows !== undefined &&
    pty.columns !== undefined &&
    pty.processGroupId !== undefined &&
    pty.terminalProcessGroupId !== undefined &&
    pty.processGroupId === pty.terminalProcessGroupId &&
    !!pty.termios &&
    pty.termios !== "unknown" &&
    !pty.termios.includes("unavailable")
  );
}
