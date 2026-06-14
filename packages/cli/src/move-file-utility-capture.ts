import type { MoveDescriptor, MovePidGraphNode, VmHandle } from "@machinen/runtime";
import { basename } from "node:path";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;

type MoveSedParsedState =
  | { path: string; scriptKind: "print-range"; startLine: number; endLine: number }
  | { path: string; scriptKind: "literal-substitution"; pattern: string; replacement: string };

export async function readMoveHeadStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["headState"]> {
  const parsed = moveHeadOrTailLinesFileState(node, "head");
  if (!parsed) {
    return undefined;
  }
  const fileIdentity = await readMoveFileIdentityInVm(vm, parsed.path);
  return fileIdentity
    ? {
        path: parsed.path,
        lines: parsed.lines,
        fileIdentity,
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveTailLinesStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["tailLinesState"]> {
  const parsed = moveHeadOrTailLinesFileState(node, "tail");
  if (!parsed) {
    return undefined;
  }
  const fileIdentity = await readMoveFileIdentityInVm(vm, parsed.path);
  return fileIdentity
    ? {
        path: parsed.path,
        lines: parsed.lines,
        fileIdentity,
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveSedStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["sedState"]> {
  const parsed = moveSedFileState(node);
  const fileIdentity = parsed ? await readMoveFileIdentityInVm(vm, parsed.path) : undefined;
  return parsed && fileIdentity
    ? {
        ...parsed,
        fileIdentity,
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveAwkFieldStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["awkFieldState"]> {
  const parsed = moveAwkFieldState(node);
  const fileIdentity = parsed ? await readMoveFileIdentityInVm(vm, parsed.path) : undefined;
  return parsed && fileIdentity
    ? {
        ...parsed,
        fileIdentity,
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveCutStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["cutState"]> {
  const parsed = moveCutState(node);
  const fileIdentity = parsed ? await readMoveFileIdentityInVm(vm, parsed.path) : undefined;
  return parsed && fileIdentity
    ? {
        ...parsed,
        fileIdentity,
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMovePasteStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["pasteState"]> {
  const parsed = movePasteState(node);
  const leftIdentity = parsed ? await readMoveFileIdentityInVm(vm, parsed.leftPath) : undefined;
  const rightIdentity = parsed ? await readMoveFileIdentityInVm(vm, parsed.rightPath) : undefined;
  return parsed && leftIdentity && rightIdentity
    ? {
        ...parsed,
        leftIdentity,
        rightIdentity,
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveUniqStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["uniqState"]> {
  const parsed = moveUniqState(node);
  const fileIdentity = parsed ? await readMoveFileIdentityInVm(vm, parsed.path) : undefined;
  return parsed && fileIdentity
    ? {
        ...parsed,
        fileIdentity,
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveCommStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["commState"]> {
  const parsed = moveTwoFileState(node, "comm");
  const identities = parsed ? await readMoveSortedTwoFileIdentitiesInVm(vm, parsed) : undefined;
  return parsed && identities
    ? {
        ...parsed,
        ...identities,
        collation: "C",
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveJoinStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<NonNullable<MoveResourcePlan["capture"]>["joinState"]> {
  const parsed = moveTwoFileState(node, "join");
  const identities = parsed ? await readMoveSortedTwoFileIdentitiesInVm(vm, parsed) : undefined;
  return parsed && identities
    ? {
        ...parsed,
        ...identities,
        key: "default-first-field",
        collation: "C",
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

function moveHeadOrTailLinesFileState(
  node: MovePidGraphNode,
  command: "head" | "tail",
): { path: string; lines: number } | undefined {
  if (moveCommandName(node) !== command || node.argv.length !== 4 || node.argv[1] !== "-n") {
    return undefined;
  }
  const lines = parsePositiveNumber(node.argv[2]);
  const path = node.argv[3];
  return lines && path?.startsWith("/") ? { path, lines } : undefined;
}

function moveAwkFieldState(
  node: MovePidGraphNode,
): { path: string; fieldIndex: number; fs: "default-whitespace" } | undefined {
  if (!moveCommandAlias(node, "awk", "mawk", "gawk") || node.argv.length !== 3) {
    return undefined;
  }
  const match = /^\{print \$(\d+)\}$/.exec(node.argv[1] ?? "");
  const path = node.argv[2];
  const fieldIndex = parsePositiveNumber(match?.[1]);
  return fieldIndex && path?.startsWith("/")
    ? { path, fieldIndex, fs: "default-whitespace" }
    : undefined;
}

function moveCutState(
  node: MovePidGraphNode,
): { path: string; delimiter: string; fields: string } | undefined {
  if (moveCommandName(node) !== "cut" || node.argv.length !== 6) {
    return undefined;
  }
  const [, delimiterFlag, delimiter, fieldsFlag, fields, path] = node.argv;
  return delimiterFlag === "-d" &&
    fieldsFlag === "-f" &&
    delimiter !== undefined &&
    delimiter.length === 1 &&
    fields !== undefined &&
    moveCutFieldsSafe(fields) &&
    path?.startsWith("/")
    ? { path, delimiter, fields }
    : undefined;
}

function movePasteState(
  node: MovePidGraphNode,
): { leftPath: string; rightPath: string } | undefined {
  return moveTwoFileState(node, "paste");
}

function moveTwoFileState(
  node: MovePidGraphNode,
  command: "comm" | "join" | "paste",
): { leftPath: string; rightPath: string } | undefined {
  if (moveCommandName(node) !== command || node.argv.length !== 3) {
    return undefined;
  }
  const [, leftPath, rightPath] = node.argv;
  return leftPath?.startsWith("/") && rightPath?.startsWith("/")
    ? { leftPath, rightPath }
    : undefined;
}

function moveUniqState(node: MovePidGraphNode): { path: string; count: boolean } | undefined {
  if (moveCommandName(node) !== "uniq") {
    return undefined;
  }
  const count = node.argv.length === 3 && node.argv[1] === "-c";
  const path = count ? node.argv[2] : node.argv[1];
  return (node.argv.length === 2 || count) && path?.startsWith("/") ? { path, count } : undefined;
}

function moveCutFieldsSafe(fields: string): boolean {
  return /^(\d+|\d+-\d+)(,(\d+|\d+-\d+))*$/.test(fields);
}

function moveSedFileState(node: MovePidGraphNode): MoveSedParsedState | undefined {
  return moveCommandName(node) === "sed"
    ? (moveSedPrintRangeState(node) ?? moveSedLiteralSubstitutionState(node))
    : undefined;
}

function moveSedPrintRangeState(node: MovePidGraphNode): MoveSedParsedState | undefined {
  if (node.argv.length !== 4 || node.argv[1] !== "-n") {
    return undefined;
  }
  const match = /^(\d+),(\d+)p$/.exec(node.argv[2] ?? "");
  const path = node.argv[3];
  if (!match || !path?.startsWith("/")) {
    return undefined;
  }
  const startLine = parsePositiveNumber(match[1]);
  const endLine = parsePositiveNumber(match[2]);
  return startLine && endLine && startLine <= endLine
    ? { path, scriptKind: "print-range", startLine, endLine }
    : undefined;
}

function moveSedLiteralSubstitutionState(node: MovePidGraphNode): MoveSedParsedState | undefined {
  if (node.argv.length !== 3) {
    return undefined;
  }
  const match = /^s\/([^/\\]+)\/([^/\\]*)\/$/.exec(node.argv[1] ?? "");
  const path = node.argv[2];
  if (!match || !path?.startsWith("/")) {
    return undefined;
  }
  const [, pattern = "", replacement = ""] = match;
  return moveSedLiteralTokenSafe(pattern) && moveSedReplacementLiteralSafe(replacement)
    ? { path, scriptKind: "literal-substitution", pattern, replacement }
    : undefined;
}

async function readMoveSortedTwoFileIdentitiesInVm(
  vm: VmHandle,
  paths: { leftPath: string; rightPath: string },
): Promise<
  | {
      leftIdentity: { size: number; sha256: string };
      rightIdentity: { size: number; sha256: string };
    }
  | undefined
> {
  const [leftIdentity, rightIdentity, leftSorted, rightSorted] = await Promise.all([
    readMoveFileIdentityInVm(vm, paths.leftPath),
    readMoveFileIdentityInVm(vm, paths.rightPath),
    readMoveFileSortedInVm(vm, paths.leftPath),
    readMoveFileSortedInVm(vm, paths.rightPath),
  ]);
  return leftIdentity && rightIdentity && leftSorted && rightSorted
    ? { leftIdentity, rightIdentity }
    : undefined;
}

async function readMoveFileSortedInVm(vm: VmHandle, path: string): Promise<boolean> {
  const result = await vm.execRaw(`LC_ALL=C sort -c ${shellQuote(path)} >/dev/null 2>&1`, {
    execTimeoutMs: 10_000,
  });
  return result.exitCode === 0;
}

async function readMoveFileIdentityInVm(
  vm: VmHandle,
  path: string,
): Promise<{ size: number; sha256: string } | undefined> {
  const quoted = shellQuote(path);
  const result = await vm.execRaw(
    `[ -f ${quoted} ] && stat -c %s ${quoted} && sha256sum ${quoted} | awk '{print $1}'`,
    { execTimeoutMs: 10_000 },
  );
  const [sizeLine, digestLine] = result.stdout.trim().split("\n");
  const size = Number(sizeLine);
  return result.exitCode === 0 &&
    Number.isInteger(size) &&
    size >= 0 &&
    /^[0-9a-f]{64}$/.test(digestLine ?? "")
    ? { size, sha256: digestLine as string }
    : undefined;
}

function moveStdoutFilePath(resourcePlan: MoveResourcePlan): string | undefined {
  const stdout = resourcePlan.resources.find((resource) => resource.fd === 1);
  return stdout?.kind === "file" && typeof stdout.path === "string" ? stdout.path : undefined;
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.exe ?? node.argv[0] ?? node.command);
}

function moveCommandAlias(node: MovePidGraphNode, ...names: string[]): boolean {
  return [moveCommandName(node), basename(node.argv[0] ?? ""), node.command].some((name) =>
    names.includes(name),
  );
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function moveSedLiteralTokenSafe(value: string): boolean {
  return /^[A-Za-z0-9 _-]+$/.test(value);
}

function moveSedReplacementLiteralSafe(value: string): boolean {
  return value === "" || (/^[A-Za-z0-9 _-]+$/.test(value) && !value.includes("&"));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
