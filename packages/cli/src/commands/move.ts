import { loadMoveDescriptor, saveMoveDescriptor, scanMovePidGraph } from "@machinen/runtime";

export function cmdMove(args: string[]): number {
  const { json, rest } = consumeJsonFlag(args);
  const subcommand = rest[0];
  if (subcommand === "scan") {
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
  if (subcommand === "save") {
    return cmdMoveSave(rest.slice(1), json);
  }
  if (subcommand === "load") {
    return cmdMoveLoad(rest.slice(1), json);
  }
  die(moveUsage());
}

function cmdMoveSave(args: string[], json: boolean): number {
  if (args.length < 2) {
    die(moveUsage());
  }
  const pid = parsePositiveInteger(args[0]!, "pid");
  const outPath = args[1]!;
  const issue = args.includes("--issue");
  const issueRepoIndex = args.indexOf("--issue-repo");
  const issueRepo = issueRepoIndex >= 0 ? args[issueRepoIndex + 1] : undefined;
  if (issueRepoIndex >= 0 && !issueRepo) {
    die("move save --issue-repo requires <owner/repo>");
  }
  const result = saveMoveDescriptor({ pid, outPath, issue, issueRepo });
  if (json) {
    emitJson({ schema_version: 1, ...result });
  } else {
    process.stdout.write(
      `${result.accepted ? "saved" : "refused"} move descriptor: ${result.descriptorPath}\n`,
    );
    if (result.issueReport) {
      process.stdout.write(
        `issue report: ${result.issueReport.repository}\n${result.issueReport.body}\n`,
      );
    }
  }
  return result.accepted ? 0 : 1;
}

function cmdMoveLoad(args: string[], json: boolean): number {
  if (args.length !== 1) {
    die(moveUsage());
  }
  const descriptor = loadMoveDescriptor(args[0]!);
  const accepted = descriptor.refusedStateClasses.length === 0;
  if (json) {
    emitJson({ schema_version: 1, accepted, descriptor });
  } else if (accepted) {
    process.stdout.write(`move load accepted descriptor for PID ${descriptor.rootPid}\n`);
  } else {
    process.stderr.write(
      `move load refused descriptor for PID ${descriptor.rootPid}: ${descriptor.refusedStateClasses
        .map((item) => item.stateClass)
        .join(", ")}\n`,
    );
  }
  return accepted ? 0 : 1;
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

function consumeJsonFlag(args: string[]): { json: boolean; rest: string[] } {
  const rest: string[] = [];
  let json = false;
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else {
      rest.push(arg);
    }
  }
  return { json, rest };
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function die(msg: string): never {
  process.stderr.write(`machinen: ${msg}\n`);
  process.exit(1);
}
