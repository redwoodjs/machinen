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
  const argvContract = parseNodeStaticArgvContract(node);
  const port = argvContract?.port ?? parseNodeStaticPort(result.stdout);
  const hasMarker = argvContract
    ? result.stdout.includes("machinen-move-envelope: static-http-argv-v1")
    : result.stdout.includes("machinen-move-envelope: static-http-v1");
  if (!port || !hasMarker) {
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
    ...(argvContract
      ? { rootDir: argvContract.rootDir, argvContract: "--port-root-static-http-v1" as const }
      : {}),
    capturedAt: new Date().toISOString(),
  };
}

function moveNodeStaticScriptPath(node: MovePidGraphNode): string | undefined {
  const command = moveCommandName(node);
  if (
    (command !== "node" && command !== "nodejs") ||
    (node.argv.length !== 2 && node.argv.length !== 6)
  ) {
    return undefined;
  }
  const scriptPath = node.argv[1];
  return scriptPath?.startsWith("/") && basename(scriptPath) === "server.mjs"
    ? scriptPath
    : undefined;
}

function parseNodeStaticArgvContract(
  node: MovePidGraphNode,
): { port: number; rootDir: string } | undefined {
  if (node.argv.length !== 6 || node.argv[2] !== "--port" || node.argv[4] !== "--root") {
    return undefined;
  }
  const port = parsePositiveNumber(node.argv[3]);
  const rootDir = node.argv[5];
  return Number.isInteger(port) && rootDir?.startsWith("/")
    ? { port: port as number, rootDir }
    : undefined;
}

function nodeStaticSourceUnsupported(source: string): boolean {
  return /node:worker_threads|worker_threads|node:child_process|child_process|cluster|\.node['"]|process\.dlopen|\bdlopen\s*\(|setInterval\s*\(|setTimeout\s*\(/.test(
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

export async function readMoveSha256StateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["sha256State"]> {
  if (moveCommandName(node) !== "sha256sum" || node.argv.length !== 2) {
    return undefined;
  }
  const path = node.argv[1];
  if (!path?.startsWith("/")) {
    return undefined;
  }
  const result = await vm.execRaw(
    `[ -f ${shellQuote(path)} ] && sha256sum ${shellQuote(path)} | awk '{print $1}'`,
    { execTimeoutMs: 10_000 },
  );
  const expectedDigest = result.stdout.trim();
  return result.exitCode === 0 && /^[0-9a-f]{64}$/.test(expectedDigest)
    ? {
        path,
        expectedDigest,
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveWcStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["wcState"]> {
  if (moveCommandName(node) !== "wc" || node.argv.length !== 3 || node.argv[1] !== "-l") {
    return undefined;
  }
  const path = node.argv[2];
  if (!path?.startsWith("/")) {
    return undefined;
  }
  const result = await vm.execRaw(`[ -f ${shellQuote(path)} ]`, { execTimeoutMs: 10_000 });
  return result.exitCode === 0
    ? {
        path,
        mode: "lines",
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveSortStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["sortState"]> {
  if (moveCommandName(node) !== "sort" || node.argv.length !== 2) {
    return undefined;
  }
  const path = node.argv[1];
  if (!path?.startsWith("/")) {
    return undefined;
  }
  const result = await vm.execRaw(`[ -f ${shellQuote(path)} ]`, { execTimeoutMs: 10_000 });
  return result.exitCode === 0
    ? { path, outputPath: moveStdoutFilePath(resourcePlan), capturedAt: new Date().toISOString() }
    : undefined;
}

export async function readMoveMvStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<NonNullable<MoveResourcePlan["capture"]>["mvState"]> {
  if (moveCommandName(node) !== "mv" || node.argv.length !== 3) {
    return undefined;
  }
  const [sourcePath, destinationPath] = node.argv.slice(1);
  if (!sourcePath?.startsWith("/") || !destinationPath?.startsWith("/")) {
    return undefined;
  }
  const result = await vm.execRaw(moveMvPreflightCommand(sourcePath, destinationPath), {
    execTimeoutMs: 10_000,
  });
  return result.exitCode === 0
    ? { sourcePath, destinationPath, capturedAt: new Date().toISOString() }
    : undefined;
}

function moveMvPreflightCommand(sourcePath: string, destinationPath: string): string {
  const source = shellQuote(sourcePath);
  const destination = shellQuote(destinationPath);
  const destinationParent = shellQuote(dirnamePath(destinationPath));
  return `[ -f ${source} ] && [ ! -e ${destination} ] && [ -d ${destinationParent} ] && [ "$(stat -c %d ${source})" = "$(stat -c %d ${destinationParent})" ]`;
}

function dirnamePath(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

export function readMoveCpState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): NonNullable<MoveResourcePlan["capture"]>["cpState"] {
  if (moveCommandName(node) !== "cp" || node.argv.length !== 3) {
    return undefined;
  }
  const [sourcePath, destinationPath] = node.argv.slice(1);
  if (!sourcePath?.startsWith("/") || !destinationPath?.startsWith("/")) {
    return undefined;
  }
  const source = moveOpenFileResource(resourcePlan, sourcePath);
  const destination = moveOpenFileResource(resourcePlan, destinationPath);
  return source && destination
    ? {
        sourcePath,
        destinationPath,
        sourceOffset: source.offset,
        destinationOffset: destination.offset,
        capturedAt: new Date().toISOString(),
      }
    : undefined;
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
export function readMoveGoStaticHttpState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): NonNullable<MoveResourcePlan["capture"]>["goStaticHttpState"] {
  return readMoveNativeStaticHttpState(node, resourcePlan, "go-static-http-v1");
}

export function readMoveRustStaticHttpState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): NonNullable<MoveResourcePlan["capture"]>["rustStaticHttpState"] {
  return readMoveNativeStaticHttpState(node, resourcePlan, "rust-static-http-v1");
}

function readMoveNativeStaticHttpState<Marker extends "go-static-http-v1" | "rust-static-http-v1">(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  expectedMarker: Marker,
):
  | {
      binaryPath: string;
      cwd: string;
      markerVersion: Marker;
      port: number;
      healthPath: string;
      capturedAt?: string;
    }
  | undefined {
  if (!moveHttpSocketsIdle(resourcePlan)) {
    return undefined;
  }
  const binaryPath = node.argv[0]?.startsWith("/") ? node.argv[0] : node.exe;
  if (!binaryPath?.startsWith("/")) {
    return undefined;
  }
  const marker = flagValue(node.argv, "--machinen-move-envelope");
  const port = parsePositiveNumber(flagValue(node.argv, "--port"));
  const healthPath = flagValue(node.argv, "--health") ?? "/health";
  return marker === expectedMarker && Number.isInteger(port) && healthPath.startsWith("/")
    ? {
        binaryPath,
        cwd: node.cwd ?? "/",
        markerVersion: expectedMarker,
        port: port as number,
        healthPath,
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function readMovePythonStaticRouteStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["pythonStaticRouteState"]> {
  const command = basename(node.argv[0] ?? node.exe ?? node.command);
  if ((command !== "python3" && command !== "python3.11") || node.argv.length !== 2) {
    return undefined;
  }
  const scriptPath = node.argv[1];
  if (!scriptPath?.startsWith("/") || !moveHttpSocketsIdle(resourcePlan)) {
    return undefined;
  }
  const result = await vm.execRaw(`cat ${shellQuote(scriptPath)} 2>/dev/null || true`, {
    execTimeoutMs: 10_000,
  });
  const source = result.stdout;
  if (!source.includes("machinen-move-envelope: python-static-route-v1")) {
    return undefined;
  }
  if (/flask|django|aiohttp|socketserver\.Threading|threading|subprocess/.test(source)) {
    return undefined;
  }
  const port = parsePythonLiteralNumber(source, "PORT");
  const route = parsePythonLiteralString(source, "ROUTE");
  const expectedBody = parsePythonLiteralString(source, "RESPONSE");
  return port && route?.startsWith("/") && expectedBody
    ? {
        executable: "python3",
        scriptPath,
        cwd: node.cwd ?? "/",
        port,
        route,
        expectedBody,
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

function parsePythonLiteralNumber(source: string, name: string): number | undefined {
  const parsed = Number(source.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, "m"))?.[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePythonLiteralString(source: string, name: string): string | undefined {
  return source.match(new RegExp(`^${name}\\s*=\\s*['"]([^'"]+)['"]`, "m"))?.[1];
}

export function readMoveTimeoutState(
  node: MovePidGraphNode,
  nodes: MovePidGraphNode[],
  childResourcePlan: MoveResourcePlan | undefined,
): NonNullable<MoveResourcePlan["capture"]>["timeoutState"] {
  if (moveCommandName(node) !== "timeout" || node.argv.length < 4 || !childResourcePlan) {
    return undefined;
  }
  const seconds = parsePositiveNumber(node.argv[1]);
  if (!Number.isInteger(seconds)) {
    return undefined;
  }
  const child = nodes.find((item) => item.ppid === node.pid);
  if (!child) {
    return undefined;
  }
  const expectedChildArgv = node.argv.slice(2);
  if (expectedChildArgv.join("\0") !== child.argv.join("\0")) {
    return undefined;
  }
  const httpState = readMoveHttpState(child, childResourcePlan);
  return httpState
    ? {
        seconds: seconds as number,
        child: "python-http-server",
        httpState,
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveEnvStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["envState"]> {
  if (!readMoveHttpState(node, resourcePlan)) {
    return undefined;
  }
  const result = await vm.execRaw(
    `tr '\\000' '\\n' </proc/${node.pid}/environ | awk -F= '$1 == "MACHINEN_MOVE_ENV_PROOF" { sub(/^[^=]*=/, ""); print; exit }'`,
    { execTimeoutMs: 10_000 },
  );
  const value = result.stdout.trim();
  return result.exitCode === 0 && /^[A-Za-z0-9_.:-]+$/.test(value)
    ? {
        key: "MACHINEN_MOVE_ENV_PROOF",
        value,
        child: "python-http-server",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export function readMoveNcState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): NonNullable<MoveResourcePlan["capture"]>["ncState"] {
  if (
    basename(node.argv[0] ?? node.command) !== "nc" ||
    node.argv.length !== 3 ||
    node.argv[1] !== "-l" ||
    !moveHttpSocketsIdle(resourcePlan)
  ) {
    return undefined;
  }
  const port = parsePositiveNumber(node.argv[2]);
  return Number.isInteger(port)
    ? { port: port as number, capturedAt: new Date().toISOString() }
    : undefined;
}

export function readMoveBusyboxHttpState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): NonNullable<MoveResourcePlan["capture"]>["busyboxHttpState"] {
  if (
    moveCommandName(node) !== "busybox" ||
    node.argv.length !== 7 ||
    node.argv[1] !== "httpd" ||
    node.argv[2] !== "-f" ||
    node.argv[3] !== "-p" ||
    node.argv[5] !== "-h" ||
    !moveHttpSocketsIdle(resourcePlan)
  ) {
    return undefined;
  }
  const port = parsePositiveNumber(node.argv[4]);
  const root = node.argv[6];
  if (!Number.isInteger(port) || !root?.startsWith("/")) {
    return undefined;
  }
  return {
    port: port as number,
    root,
    capturedAt: new Date().toISOString(),
  };
}

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
  const parsed = parsePythonHttpServerArgs(node.argv.slice(moduleIndex + 2));
  return parsed
    ? {
        executable: "python3",
        port: parsed.port,
        cwd: node.cwd ?? "/",
        ...(parsed.directory ? { directory: parsed.directory } : {}),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

function parsePythonHttpServerArgs(
  args: string[],
): { directory?: string; port: number } | undefined {
  const directory = parsePythonHttpDirectoryArg(args);
  if (args[0] === "--directory" && !directory) {
    return undefined;
  }
  const portArg = pythonHttpPortArg(args, directory);
  if (portArg?.startsWith("-")) {
    return undefined;
  }
  if (!pythonHttpTrailingArgsSupported(args, directory, portArg)) {
    return undefined;
  }
  const port = portArg === undefined ? 8000 : parsePositiveNumber(portArg);
  return Number.isInteger(port)
    ? { ...(directory ? { directory } : {}), port: port as number }
    : undefined;
}

function parsePythonHttpDirectoryArg(args: string[]): string | undefined {
  const directory = args[0] === "--directory" ? args[1] : undefined;
  return directory?.startsWith("/") ? directory : undefined;
}

function pythonHttpPortArg(args: string[], directory: string | undefined): string | undefined {
  return directory ? args[2] : args[0];
}

function pythonHttpTrailingArgsSupported(
  args: string[],
  directory: string | undefined,
  portArg: string | undefined,
): boolean {
  const trailingArgs = args.slice(directory ? 3 : portArg ? 1 : 0);
  return (
    trailingArgs.length === 0 ||
    (trailingArgs.length === 2 && trailingArgs[0] === "--bind" && trailingArgs[1] === "127.0.0.1")
  );
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
