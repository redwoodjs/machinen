import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export const MOVE_DESCRIPTOR_FORMAT_VERSION = 1 as const;
export const MOVE_REFUSAL_CODE = "move-unproven-state-class" as const;

export type MoveProcessStateClass =
  | "process-identity"
  | "argv-env-cwd"
  | "open-files"
  | "sockets"
  | "threads"
  | "unknown";

export interface MovePidGraphNode {
  pid: number;
  ppid: number | undefined;
  command: string;
  argv: string[];
  cwd: string | undefined;
}

export interface MovePidGraphEdge {
  fromPid: number;
  toPid: number;
  kind: "parent-child";
}

export interface MoveRefusalEvidence {
  stateClass: MoveProcessStateClass;
  reason: string;
  evidence: string;
  nextAction: string;
}

export interface MovePidGraph {
  formatVersion: typeof MOVE_DESCRIPTOR_FORMAT_VERSION;
  kind: "machinen.move.pid-graph";
  rootPid: number | undefined;
  scannedAt: string;
  nodes: MovePidGraphNode[];
  edges: MovePidGraphEdge[];
  translatedStateClasses: MoveProcessStateClass[];
  refusedStateClasses: MoveRefusalEvidence[];
}

export interface MoveDescriptor extends Omit<MovePidGraph, "kind"> {
  kind: "machinen.move.descriptor";
  target: "cross-isa-target-native-pid-translation";
  productSurface: "machinen move";
}

export interface MoveSaveResult {
  accepted: boolean;
  descriptorPath: string;
  descriptor: MoveDescriptor;
  refusalCode?: typeof MOVE_REFUSAL_CODE;
  issueReport?: MoveIssueReport;
}

export interface MoveIssueReport {
  title: string;
  body: string;
  repository: string;
}

export function scanMovePidGraph(rootPid?: number): MovePidGraph {
  const nodes = readProcNodes(rootPid);
  const pidSet = new Set(nodes.map((node) => node.pid));
  const edges = nodes
    .filter((node) => node.ppid !== undefined && pidSet.has(node.ppid))
    .map((node) => ({ fromPid: node.ppid!, toPid: node.pid, kind: "parent-child" as const }));
  return {
    formatVersion: MOVE_DESCRIPTOR_FORMAT_VERSION,
    kind: "machinen.move.pid-graph",
    rootPid,
    scannedAt: new Date().toISOString(),
    nodes,
    edges,
    translatedStateClasses: ["process-identity", "argv-env-cwd"],
    refusedStateClasses: buildRefusals(rootPid, nodes),
  };
}

export function createMoveDescriptor(pid: number): MoveDescriptor {
  const graph = scanMovePidGraph(pid);
  return {
    ...graph,
    kind: "machinen.move.descriptor",
    target: "cross-isa-target-native-pid-translation",
    productSurface: "machinen move",
  };
}

export function saveMoveDescriptor(input: {
  pid: number;
  outPath: string;
  issue?: boolean;
  issueRepo?: string;
}): MoveSaveResult {
  const descriptor = createMoveDescriptor(input.pid);
  const descriptorPath = resolve(input.outPath);
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
  const accepted = descriptor.refusedStateClasses.length === 0;
  return {
    accepted,
    descriptorPath,
    descriptor,
    refusalCode: accepted ? undefined : MOVE_REFUSAL_CODE,
    issueReport: input.issue
      ? buildMoveIssueReport(descriptor, input.issueRepo ?? "redwoodjs/machinen")
      : undefined,
  };
}

export function loadMoveDescriptor(path: string): MoveDescriptor {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as Partial<MoveDescriptor>;
  if (parsed.kind !== "machinen.move.descriptor") {
    throw new Error("move descriptor kind must be machinen.move.descriptor");
  }
  if (parsed.formatVersion !== MOVE_DESCRIPTOR_FORMAT_VERSION) {
    throw new Error(`move descriptor formatVersion must be ${MOVE_DESCRIPTOR_FORMAT_VERSION}`);
  }
  if (parsed.productSurface !== "machinen move") {
    throw new Error("move descriptor productSurface must be machinen move");
  }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.refusedStateClasses)) {
    throw new Error("move descriptor must include nodes and refusedStateClasses arrays");
  }
  return parsed as MoveDescriptor;
}

export function buildMoveIssueReport(
  descriptor: MoveDescriptor,
  repository = "redwoodjs/machinen",
): MoveIssueReport {
  const stateClasses = descriptor.refusedStateClasses.map((item) => item.stateClass).join(", ");
  return {
    repository,
    title: `move refused PID ${descriptor.rootPid ?? "unknown"}: ${stateClasses || "no refusals"}`,
    body: [
      "## Problem",
      "`machinen move` refused this PID graph because some state classes are not proven yet.",
      "",
      "## Redacted evidence",
      `- root pid: ${descriptor.rootPid ?? "unknown"}`,
      `- process count: ${descriptor.nodes.length}`,
      `- refused classes: ${stateClasses || "none"}`,
      "",
      "## Next action",
      ...descriptor.refusedStateClasses.map((item) => `- ${item.stateClass}: ${item.nextAction}`),
    ].join("\n"),
  };
}

function readProcNodes(rootPid: number | undefined): MovePidGraphNode[] {
  if (rootPid !== undefined) {
    return [readProcNode(rootPid)];
  }
  if (!existsSync("/proc")) {
    return [fallbackNode(process.pid)];
  }
  return readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .slice(0, 250)
    .map((entry) => readProcNode(Number(entry)))
    .sort((left, right) => left.pid - right.pid);
}

function readProcNode(pid: number): MovePidGraphNode {
  if (!existsSync(`/proc/${pid}`)) {
    return fallbackNode(pid);
  }
  const stat = readOptional(`/proc/${pid}/stat`);
  const argv = splitProc0(readOptional(`/proc/${pid}/cmdline`));
  const command = argv[0] ?? parseStatCommand(stat) ?? `pid-${pid}`;
  return {
    pid,
    ppid: parsePpid(stat),
    command: basename(command),
    argv,
    cwd: undefined,
  };
}

function fallbackNode(pid: number): MovePidGraphNode {
  return {
    pid,
    ppid: pid === process.pid ? process.ppid : undefined,
    command: pid === process.pid ? basename(process.argv[0] ?? "node") : `pid-${pid}`,
    argv: pid === process.pid ? process.argv : [],
    cwd: pid === process.pid ? process.cwd() : undefined,
  };
}

function buildRefusals(
  rootPid: number | undefined,
  nodes: MovePidGraphNode[],
): MoveRefusalEvidence[] {
  return [
    {
      stateClass: "open-files",
      reason: "open file descriptor identity is not translated by this descriptor yet",
      evidence:
        rootPid === undefined ? "scan-only-no-root-pid" : `pid:${rootPid}:fd-audit-required`,
      nextAction: "add a move-owned fd detector and target-native file/socket reconstruction proof",
    },
    {
      stateClass: "sockets",
      reason:
        "kernel socket identity is not preserved across ISA and must be reconstructed or refused",
      evidence: `nodes:${nodes.length}:socket-audit-required`,
      nextAction: "attach socket-family evidence and a target-native reconstruction verifier",
    },
  ];
}

function readOptional(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function splitProc0(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function parsePpid(stat: string): number | undefined {
  const afterName = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  const parsed = Number(afterName[1]);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseStatCommand(stat: string): string | undefined {
  const match = /^\d+ \((.*)\)/.exec(stat);
  return match?.[1];
}
