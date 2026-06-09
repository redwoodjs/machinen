import type { MoveDescriptor, MovePidGraphNode, VmHandle } from "@machinen/runtime";
import { basename } from "node:path";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;

export async function readMovePingStateInVm(
  vm: VmHandle,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["pingState"]> {
  const path = moveStdoutFilePath(resourcePlan);
  if (!path) {
    return undefined;
  }
  const result = await vm.execRaw(`tail -n 500 ${shellQuote(path)} 2>/dev/null || true`, {
    execTimeoutMs: 10_000,
  });
  return parsePingStateFromOutput(result.stdout);
}

function moveStdoutFilePath(resourcePlan: MoveResourcePlan): string | undefined {
  const stdout = resourcePlan.resources.find((resource) => resource.fd === 1);
  return stdout?.kind === "file" && typeof stdout.path === "string" ? stdout.path : undefined;
}

function parsePingStateFromOutput(
  stdout: string,
): NonNullable<MoveResourcePlan["capture"]>["pingState"] {
  const sequences = Array.from(stdout.matchAll(/icmp_seq=(\d+)/g), (match) => Number(match[1]));
  const replies = stdout.split("\n").filter((line) => /bytes from .*icmp_seq=\d+/.test(line));
  const errors = stdout.split("\n").filter((line) => /^From .*icmp_seq=\d+/.test(line));
  const lastSequence = sequences.at(-1);
  if (!lastSequence) {
    return undefined;
  }
  return {
    ntransmitted: lastSequence,
    nreceived: replies.length,
    nerrors: errors.length,
    lastSequence,
  };
}

export async function readMoveSleepStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<NonNullable<MoveResourcePlan["capture"]>["sleepState"]> {
  const originalMs = moveSleepOriginalMs(node);
  if (originalMs === undefined) {
    return undefined;
  }
  const timing = await readMoveProcessTimingInVm(vm, node.pid);
  if (!timing) {
    return undefined;
  }
  const elapsedMs = Math.max(0, timing.uptimeMs - timing.startMs);
  return {
    originalMs,
    elapsedMs,
    remainingMs: Math.max(0, originalMs - elapsedMs),
    capturedAt: new Date().toISOString(),
  };
}

// fallow-ignore-next-line complexity
export async function readMoveReaderStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["readerState"]> {
  const path = moveSingleAbsoluteArg(node, "cat");
  if (!path) {
    return undefined;
  }
  const outputPath = moveStdoutFilePath(resourcePlan);
  const file = resourcePlan.resources.find(
    (resource) =>
      resource.kind === "file" && resource.path === path && typeof resource.offset === "number",
  );
  const outputOffset = outputPath ? await readMoveFileSizeInVm(vm, outputPath) : undefined;
  const offset = typeof file?.offset === "number" ? file.offset : outputOffset;
  return {
    command: "cat",
    path,
    offset: offset ?? 0,
    outputPath,
    capturedAt: new Date().toISOString(),
  };
}

async function readMoveFileSizeInVm(vm: VmHandle, path: string): Promise<number | undefined> {
  const result = await vm.execRaw(`stat -c %s ${shellQuote(path)} 2>/dev/null || true`, {
    execTimeoutMs: 10_000,
  });
  const parsed = Number(result.stdout.trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function readMoveNodeStaticHttpStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["nodeStaticHttpState"]> {
  const scriptPath = moveNodeStaticScriptPath(node);
  if (!scriptPath || !moveHttpSocketsIdle(resourcePlan)) {
    return undefined;
  }
  const result = await vm.execRaw(`cat ${shellQuote(scriptPath)} 2>/dev/null || true`, {
    execTimeoutMs: 10_000,
  });
  const port = parseNodeStaticPort(result.stdout);
  if (!port || !result.stdout.includes("machinen-move-envelope: static-http-v1")) {
    return undefined;
  }
  if (nodeStaticSourceUnsupported(result.stdout)) {
    return undefined;
  }
  if (!result.stdout.includes('"/health"') && !result.stdout.includes("'/health'")) {
    return undefined;
  }
  return {
    scriptPath,
    cwd: node.cwd ?? "/",
    port,
    healthPath: "/health",
    capturedAt: new Date().toISOString(),
  };
}

function moveNodeStaticScriptPath(node: MovePidGraphNode): string | undefined {
  const command = moveCommandName(node);
  if ((command !== "node" && command !== "nodejs") || node.argv.length !== 2) {
    return undefined;
  }
  const scriptPath = node.argv[1];
  return scriptPath?.startsWith("/") && basename(scriptPath) === "server.mjs"
    ? scriptPath
    : undefined;
}

function nodeStaticSourceUnsupported(source: string): boolean {
  return /node:worker_threads|worker_threads|node:child_process|child_process|cluster|\.node['"]/.test(
    source,
  );
}

function parseNodeStaticPort(source: string): number | undefined {
  const parsed = Number(source.match(/const\s+PORT\s*=\s*(\d+)/)?.[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function readMoveTarState(
  node: MovePidGraphNode,
): NonNullable<MoveResourcePlan["capture"]>["tarState"] {
  if (moveCommandName(node) !== "tar" || node.argv.length !== 4) {
    return undefined;
  }
  const [, createFlag, archivePath, sourceDir] = node.argv;
  if (createFlag !== "-cf" || !archivePath?.startsWith("/") || !sourceDir?.startsWith("/")) {
    return undefined;
  }
  if (pathIsWithin(sourceDir, archivePath)) {
    return undefined;
  }
  return { archivePath, sourceDir, capturedAt: new Date().toISOString() };
}

function pathIsWithin(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith("/") ? root : `${root}/`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}

export async function readMoveFindStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["findState"]> {
  const rootPath = moveFindRootPath(node);
  if (!rootPath) {
    return undefined;
  }
  const outputPath = moveStdoutFilePath(resourcePlan);
  const lastPath = outputPath ? await readMoveLastLineInVm(vm, outputPath) : undefined;
  return { rootPath, outputPath, lastPath, capturedAt: new Date().toISOString() };
}

function moveFindRootPath(node: MovePidGraphNode): string | undefined {
  if (moveCommandName(node) !== "find" || node.argv.length !== 5) {
    return undefined;
  }
  const [rootPath, typeFlag, typeValue, printFlag] = node.argv.slice(1);
  return rootPath?.startsWith("/") &&
    typeFlag === "-type" &&
    typeValue === "f" &&
    printFlag === "-print"
    ? rootPath
    : undefined;
}

async function readMoveLastLineInVm(vm: VmHandle, path: string): Promise<string | undefined> {
  const result = await vm.execRaw(lastCompleteLineCommand(shellQuote(path)), {
    execTimeoutMs: 10_000,
  });
  const line = result.stdout.trimEnd().split("\n").at(-1);
  return line ? line : undefined;
}

function lastCompleteLineCommand(quotedPath: string): string {
  return `if [ -f ${quotedPath} ] && [ -s ${quotedPath} ]; then
  last_byte=$(tail -c 1 ${quotedPath} 2>/dev/null | od -An -t x1 | tr -d ' \\n')
  if [ "$last_byte" = "0a" ]; then
    tail -n 1 ${quotedPath} 2>/dev/null || true
  else
    tail -n 2 ${quotedPath} 2>/dev/null | sed '$d' | tail -n 1 || true
  fi
fi`;
}

// fallow-ignore-next-line complexity
export function readMoveDdState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): NonNullable<MoveResourcePlan["capture"]>["ddState"] {
  if (moveCommandName(node) !== "dd") {
    return undefined;
  }
  const args = parseDdArgs(node.argv.slice(1));
  if (!args) {
    return undefined;
  }
  const input = moveOpenFileResource(resourcePlan, args.inputPath);
  const output = moveOpenFileResource(resourcePlan, args.outputPath);
  return input && output
    ? {
        inputPath: args.inputPath,
        outputPath: args.outputPath,
        blockSize: args.blockSize,
        inputOffset: input.offset,
        outputOffset: output.offset,
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

function parseDdArgs(
  argv: string[],
): { inputPath: string; outputPath: string; blockSize: number } | undefined {
  if (argv.length !== 3) {
    return undefined;
  }
  const inputPath = parseKeyValueArg(argv, "if")?.value;
  const outputPath = parseKeyValueArg(argv, "of")?.value;
  const blockSize = parseDdBlockSize(parseKeyValueArg(argv, "bs")?.value);
  return inputPath?.startsWith("/") && outputPath?.startsWith("/") && blockSize
    ? { inputPath, outputPath, blockSize }
    : undefined;
}

function parseKeyValueArg(argv: string[], key: string): { key: string; value: string } | undefined {
  const prefix = `${key}=`;
  const arg = argv.find((item) => item.startsWith(prefix));
  return arg ? { key, value: arg.slice(prefix.length) } : undefined;
}

function parseDdBlockSize(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function moveOpenFileResource(
  resourcePlan: MoveResourcePlan,
  path: string,
): { offset: number } | undefined {
  const resource = resourcePlan.resources.find(
    (item) => item.kind === "file" && item.path === path && typeof item.offset === "number",
  );
  return typeof resource?.offset === "number" ? { offset: resource.offset } : undefined;
}

// fallow-ignore-next-line complexity
export function readMoveGrepState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): NonNullable<MoveResourcePlan["capture"]>["grepState"] {
  if (basename(node.exe ?? node.argv[0] ?? node.command) !== "grep" || node.argv.length !== 3) {
    return undefined;
  }
  const path = node.argv[2];
  if (!path?.startsWith("/")) {
    return undefined;
  }
  const file = resourcePlan.resources.find(
    (resource) =>
      resource.kind === "file" && resource.path === path && typeof resource.offset === "number",
  );
  return {
    pattern: node.argv[1]!,
    path,
    offset: typeof file?.offset === "number" ? file.offset : 0,
    outputPath: moveStdoutFilePath(resourcePlan),
    capturedAt: new Date().toISOString(),
  };
}

// fallow-ignore-next-line complexity
export function readMoveWatchState(
  node: MovePidGraphNode,
): NonNullable<MoveResourcePlan["capture"]>["watchState"] {
  if (basename(node.exe ?? node.argv[0] ?? node.command) !== "watch") {
    return undefined;
  }
  const args = node.argv.slice(1);
  const intervalIndex = args.findIndex((arg) => arg === "-n" || arg === "--interval");
  const intervalSeconds = parsePositiveNumber(args[intervalIndex + 1]) ?? 2;
  const command = intervalIndex >= 0 ? args.slice(intervalIndex + 2) : args;
  return command.length > 0
    ? { intervalSeconds, command, capturedAt: new Date().toISOString() }
    : undefined;
}

// fallow-ignore-next-line complexity
export function readMoveShellState(
  node: MovePidGraphNode,
): NonNullable<MoveResourcePlan["capture"]>["shellState"] {
  const shell = basename(node.exe ?? node.argv[0] ?? node.command);
  if ((shell !== "sh" && shell !== "dash") || node.argv.length !== 1) {
    return undefined;
  }
  return {
    shell,
    cwd: node.cwd ?? "/",
    terminal: "script-pty",
    capturedAt: new Date().toISOString(),
  };
}

// fallow-ignore-next-line complexity
export function readMoveHttpState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): NonNullable<MoveResourcePlan["capture"]>["httpState"] {
  const command = basename(node.argv[0] ?? node.exe ?? node.command);
  if (command !== "python3" && command !== "python3.11") {
    return undefined;
  }
  const moduleIndex = node.argv.findIndex((arg) => arg === "-m");
  if (node.argv[moduleIndex + 1] !== "http.server" || !moveHttpSocketsIdle(resourcePlan)) {
    return undefined;
  }
  return {
    executable: "python3",
    port: parsePositiveIntegerOrDefault(node.argv[moduleIndex + 2], 8000),
    cwd: node.cwd ?? "/",
    capturedAt: new Date().toISOString(),
  };
}

function moveHttpSocketsIdle(resourcePlan: MoveResourcePlan): boolean {
  return resourcePlan.resources.filter((resource) => resource.kind === "socket").length === 1;
}

// fallow-ignore-next-line complexity
function moveSingleAbsoluteArg(node: MovePidGraphNode, command: string): string | undefined {
  if (basename(node.exe ?? node.argv[0] ?? node.command) !== command || node.argv.length !== 2) {
    return undefined;
  }
  const path = node.argv[1];
  return path?.startsWith("/") ? path : undefined;
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.exe ?? node.argv[0] ?? node.command);
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePositiveIntegerOrDefault(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readMoveLessState(
  node: MovePidGraphNode,
): NonNullable<MoveResourcePlan["capture"]>["lessState"] {
  const parsed = moveTerminalFileState(node, "less");
  return parsed
    ? {
        path: parsed.path,
        line: parsed.line,
        terminal: "script-pty",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export function readMoveViState(
  node: MovePidGraphNode,
): NonNullable<MoveResourcePlan["capture"]>["viState"] {
  const parsed = moveTerminalFileState(node, "vi");
  if (!parsed) {
    return undefined;
  }
  const dirtyText = moveViDirtyText(node.argv);
  return {
    path: parsed.path,
    line: parsed.line,
    mode: dirtyText === undefined ? "normal-read-only" : "normal-dirty-buffer",
    terminal: "script-pty",
    dirtyText,
    searchPattern: moveViSearchPattern(node.argv),
    capturedAt: new Date().toISOString(),
  };
}

function moveViDirtyText(argv: string[]): string | undefined {
  return argv.find((arg) => /^\+normal!? Go/.test(arg))?.replace(/^\+normal!? Go/, "");
}

function moveViSearchPattern(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith("+/") && arg.length > 2)?.slice(2);
}

// fallow-ignore-next-line complexity
function moveTerminalFileState(
  node: MovePidGraphNode,
  command: "less" | "vi",
): { path: string; line: number } | undefined {
  if (basename(node.exe ?? node.argv[0] ?? node.command) !== command) {
    return undefined;
  }
  const path = node.argv.at(-1);
  if (!path?.startsWith("/")) {
    return undefined;
  }
  const line = parseLineArg(node.argv.find((arg) => /^\+\d+$/.test(arg)));
  return { path, line: line ?? 1 };
}

function parseLineArg(value: string | undefined): number | undefined {
  const parsed = Number(value?.slice(1));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

// fallow-ignore-next-line complexity
export function readMoveTailGrepPipelineState(
  nodes: MovePidGraphNode[],
  tailResourcePlan: MoveResourcePlan | undefined,
): NonNullable<MoveResourcePlan["capture"]>["tailGrepPipelineState"] {
  if (!tailResourcePlan) {
    return undefined;
  }
  const tailNode = nodes.find((node) => moveCommandName(node) === "tail");
  const grepNode = nodes.find((node) => moveCommandName(node) === "grep");
  if (!tailNode || !grepNode || nodes.filter(isTailOrGrepNode).length !== 2) {
    return undefined;
  }
  const tailState = readMoveTailState(tailNode, tailResourcePlan);
  const grepPattern = moveLineBufferedGrepPattern(grepNode);
  return tailState && grepPattern
    ? {
        tailPath: tailState.path,
        offset: tailState.offset,
        pattern: grepPattern,
        lineBuffered: true,
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

function isTailOrGrepNode(node: MovePidGraphNode): boolean {
  const command = moveCommandName(node);
  return command === "tail" || command === "grep";
}

function moveLineBufferedGrepPattern(node: MovePidGraphNode): string | undefined {
  if (node.argv.length !== 3 || node.argv[1] !== "--line-buffered") {
    return undefined;
  }
  return node.argv[2];
}

export function readMoveTailState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): NonNullable<MoveResourcePlan["capture"]>["tailState"] {
  const path = moveTailFollowPath(node);
  if (!path) {
    return undefined;
  }
  const file = resourcePlan.resources.find(
    (resource) =>
      resource.kind === "file" && resource.path === path && typeof resource.offset === "number",
  );
  return typeof file?.offset === "number"
    ? {
        path,
        offset: file.offset,
        followMode: "poll-or-inotify",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

// fallow-ignore-next-line complexity
function moveTailFollowPath(node: MovePidGraphNode): string | undefined {
  if (basename(node.exe ?? node.argv[0] ?? node.command) !== "tail") {
    return undefined;
  }
  const args = node.argv.slice(1);
  const followIndex = args.findIndex((arg) => arg === "-f" || arg === "--follow");
  const path = args.at(-1);
  return followIndex >= 0 && path?.startsWith("/") ? path : undefined;
}

// fallow-ignore-next-line complexity
function moveSleepOriginalMs(node: MovePidGraphNode): number | undefined {
  if (basename(node.exe ?? node.argv[0] ?? node.command) !== "sleep") {
    return undefined;
  }
  const duration = parseSleepDurationMs(node.argv[1]);
  return duration !== undefined && node.argv.length === 2 ? duration : undefined;
}

// fallow-ignore-next-line complexity
function parseSleepDurationMs(value: string | undefined): number | undefined {
  const match = value?.match(/^(\d+(?:\.\d+)?)([smhd]?)$/);
  if (!match) {
    return undefined;
  }
  const multiplier = sleepDurationMultiplier(match[2] ?? "");
  const ms = Number(match[1]) * multiplier;
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : undefined;
}

function sleepDurationMultiplier(suffix: string): number {
  return { "": 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[suffix] ?? 1000;
}

async function readMoveProcessTimingInVm(
  vm: VmHandle,
  pid: number,
): Promise<{ uptimeMs: number; startMs: number } | undefined> {
  const result = await vm.execRaw(
    `printf 'UPTIME\t'; cut -d' ' -f1 /proc/uptime; printf 'CLK_TCK\t'; getconf CLK_TCK; printf 'STAT\t'; cat /proc/${pid}/stat 2>/dev/null || true`,
    { execTimeoutMs: 10_000 },
  );
  if (result.exitCode !== 0) {
    return undefined;
  }
  return parseMoveProcessTiming(result.stdout);
}

// fallow-ignore-next-line complexity
function parseMoveProcessTiming(stdout: string): { uptimeMs: number; startMs: number } | undefined {
  const rows = new Map(stdout.split("\n").map((row) => row.split("\t", 2) as [string, string]));
  const uptimeSeconds = Number(rows.get("UPTIME"));
  const clockTicksPerSecond = Number(rows.get("CLK_TCK"));
  const startTicks = parseStatStartTicks(rows.get("STAT") ?? "");
  if (!Number.isFinite(uptimeSeconds) || !Number.isFinite(clockTicksPerSecond) || !startTicks) {
    return undefined;
  }
  return {
    uptimeMs: Math.round(uptimeSeconds * 1000),
    startMs: Math.round((startTicks / clockTicksPerSecond) * 1000),
  };
}

function parseStatStartTicks(stat: string): number | undefined {
  const rest = stat.match(/^\d+\s+\(.*\)\s+(.+)$/)?.[1]?.split(/\s+/) ?? [];
  const parsed = Number(rest[19]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
