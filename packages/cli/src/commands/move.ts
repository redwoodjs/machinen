import { loadMoveDescriptor, saveMoveDescriptor, scanMovePidGraph } from "@machinen/runtime";

import { consumeJsonFlag } from "../args.ts";
import { die } from "../errors.ts";

type MoveHandler = (args: string[], json: boolean) => number;

const MOVE_HANDLERS = new Map<string, MoveHandler>([
  ["scan", cmdMoveScan],
  ["save", cmdMoveSave],
  ["load", cmdMoveLoad],
]);

export function cmdMove(args: string[]): number {
  const { json, rest } = consumeJsonFlag(args);
  const handler = MOVE_HANDLERS.get(rest[0] ?? "");
  if (!handler) {
    die(moveUsage());
  }
  return handler(rest.slice(1), json);
}

function cmdMoveScan(_args: string[], json: boolean): number {
  const graph = scanMovePidGraph();
  if (json) {
    emitJson({ schema_version: 1, ...graph });
  } else {
    process.stdout.write(
      `move scan: ${graph.nodes.length} processes; refused=${graph.refusedStateClasses.length}\n`,
    );
  }
  return graph.refusedStateClasses.length === 0 ? 0 : 1;
}

function cmdMoveSave(args: string[], json: boolean): number {
  const options = parseMoveSaveArgs(args);
  const result = saveMoveDescriptor(options);
  reportMoveSaveResult(result, json);
  return result.accepted ? 0 : 1;
}

type MoveSaveOptions = Parameters<typeof saveMoveDescriptor>[0];
type MoveSaveResult = ReturnType<typeof saveMoveDescriptor>;

function parseMoveSaveArgs(args: string[]): MoveSaveOptions {
  if (args.length < 2) {
    die(moveUsage());
  }
  const issueRepo = parseIssueRepo(args);
  return {
    pid: parsePositiveInteger(args[0]!, "pid"),
    outPath: args[1]!,
    issue: args.includes("--issue"),
    issueRepo,
  };
}

function parseIssueRepo(args: string[]): string | undefined {
  const issueRepoIndex = args.indexOf("--issue-repo");
  if (issueRepoIndex === -1) {
    return undefined;
  }
  const issueRepo = args[issueRepoIndex + 1];
  if (!issueRepo) {
    die("move save --issue-repo requires <owner/repo>");
  }
  return issueRepo;
}

function reportMoveSaveResult(result: MoveSaveResult, json: boolean): void {
  if (json) {
    emitJson({ schema_version: 1, ...result });
    return;
  }
  process.stdout.write(
    `${result.accepted ? "saved" : "refused"} move descriptor: ${result.descriptorPath}\n`,
  );
  printIssueReport(result);
}

function printIssueReport(result: MoveSaveResult): void {
  if (!result.issueReport) {
    return;
  }
  process.stdout.write(
    `issue report: ${result.issueReport.repository}\n${result.issueReport.body}\n`,
  );
}

function cmdMoveLoad(args: string[], json: boolean): number {
  if (args.length !== 1) {
    die(moveUsage());
  }
  const descriptor = loadMoveDescriptor(args[0]!);
  const accepted = descriptor.refusedStateClasses.length === 0;
  reportMoveLoadResult(descriptor, accepted, json);
  return accepted ? 0 : 1;
}

type MoveDescriptor = ReturnType<typeof loadMoveDescriptor>;

function reportMoveLoadResult(descriptor: MoveDescriptor, accepted: boolean, json: boolean): void {
  if (json) {
    emitJson({ schema_version: 1, accepted, descriptor });
    return;
  }
  if (accepted) {
    process.stdout.write(`move load accepted descriptor for PID ${descriptor.rootPid}\n`);
    return;
  }
  process.stderr.write(
    `move load refused descriptor for PID ${descriptor.rootPid}: ${refusedStateClasses(descriptor)}\n`,
  );
}

function refusedStateClasses(descriptor: MoveDescriptor): string {
  return descriptor.refusedStateClasses.map((item) => item.stateClass).join(", ");
}

function moveUsage(): string {
  return "usage: machinen move scan [--json] | machinen move save <pid> <out> [--issue] [--issue-repo <owner/repo>] [--json] | machinen move load <descriptor> [--json]";
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    die(`${flag} must be a positive integer`);
  }
  return parsed;
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
