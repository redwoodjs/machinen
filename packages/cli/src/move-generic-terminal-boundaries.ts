import type { MoveDescriptor, MovePidGraphNode } from "@machinen/runtime";

import { supportedNoninteractivePtyProbe } from "./move-generic-pty-terminal.ts";
import type { GenericPreflight } from "./move-generic-wave2-baseline.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];
type GenericRefusalClass = NonNullable<GenericState>["refusalClasses"][number];

type Boundary = {
  resourceClass: string;
  reason: string;
  evidence: string;
};

export function genericTerminalBoundaryRefusals(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  preflight: GenericPreflight,
): GenericRefusalClass[] {
  if (
    !hasPtyResource(resourcePlan) ||
    supportedNoninteractivePtyProbe(node, resourcePlan, preflight)
  ) {
    return [];
  }
  return terminalBoundaries(node, preflight).map((boundary) => refusal(boundary));
}

function terminalBoundaries(node: MovePidGraphNode, preflight: GenericPreflight): Boundary[] {
  return [
    dirtyEditorBoundary(node),
    alternateScreenBoundary(node),
    jobControlBoundary(node),
    foregroundPgrpBoundary(preflight),
    unknownTermiosBoundary(preflight),
    windowSizeBoundary(preflight),
  ].filter((item): item is Boundary => item !== undefined);
}

function dirtyEditorBoundary(node: MovePidGraphNode): Boundary | undefined {
  return isEditor(commandName(node)) && node.argv.some((arg) => /^\+normal!? Go/.test(arg))
    ? terminalBoundary("terminalEditorDirtyState", "dirty editor buffer state", node)
    : undefined;
}

function alternateScreenBoundary(node: MovePidGraphNode): Boundary | undefined {
  return ["less", "vi", "vim", "view", "nano", "top", "watch"].includes(commandName(node))
    ? terminalBoundary("terminalAlternateScreenState", "alternate-screen terminal state", node)
    : undefined;
}

function jobControlBoundary(node: MovePidGraphNode): Boundary | undefined {
  return looksLikeShellWrapper(node)
    ? terminalBoundary("terminalJobControlState", "job-control terminal state", node)
    : undefined;
}

function foregroundPgrpBoundary(preflight: GenericPreflight): Boundary | undefined {
  return preflight.ptys.length === 0 || preflight.ptys.some((pty) => foregroundPgrpAmbiguous(pty))
    ? ptyBoundary("terminalForegroundProcessGroup", "foreground process-group ambiguity")
    : undefined;
}

function unknownTermiosBoundary(preflight: GenericPreflight): Boundary | undefined {
  return preflight.ptys.length === 0 || preflight.ptys.some((pty) => unknownText(pty.termios))
    ? ptyBoundary("terminalUnknownTermios", "unknown terminal mode/termios state")
    : undefined;
}

function windowSizeBoundary(preflight: GenericPreflight): Boundary | undefined {
  return preflight.ptys.length === 0 ||
    preflight.ptys.some((pty) => pty.rows === undefined || pty.columns === undefined)
    ? ptyBoundary("terminalWindowSize", "unsupported or unknown window-size transition")
    : undefined;
}

function hasPtyResource(resourcePlan: MoveResourcePlan): boolean {
  return resourcePlan.resources.some((resource) => resource.kind === "pty");
}

function foregroundPgrpAmbiguous(pty: GenericPreflight["ptys"][number]): boolean {
  return (
    pty.processGroupId === undefined ||
    pty.terminalProcessGroupId === undefined ||
    pty.processGroupId !== pty.terminalProcessGroupId
  );
}

function unknownText(value: string | undefined): boolean {
  return !value || value === "unknown" || value.includes("unavailable");
}

function isEditor(command: string): boolean {
  return ["vi", "vim", "view", "nano"].includes(command);
}

function looksLikeShellWrapper(node: MovePidGraphNode): boolean {
  return (
    ["sh", "dash", "bash", "zsh", "fish", "busybox"].includes(commandName(node)) &&
    node.argv.some((arg) => arg === "-c")
  );
}

function commandName(node: MovePidGraphNode): string {
  return (node.exe ?? node.argv[0] ?? node.command).split("/").pop() ?? node.command;
}

function terminalBoundary(resourceClass: string, reason: string, node: MovePidGraphNode): Boundary {
  return {
    resourceClass,
    reason: `${reason} is not modeled by generic PTY migration`,
    evidence: `command=${node.command} argv=${JSON.stringify(node.argv)}`,
  };
}

function ptyBoundary(resourceClass: string, reason: string): Boundary {
  return {
    resourceClass,
    reason,
    evidence: "PTY descriptor is refusal-only until terminal state is modeled",
  };
}

function refusal(boundary: Boundary): GenericRefusalClass {
  return {
    resourceClass: boundary.resourceClass,
    status: "refused",
    reason: boundary.reason,
    evidence: boundary.evidence,
    nextAction: `model ${boundary.resourceClass} before generic PTY support`,
  };
}
