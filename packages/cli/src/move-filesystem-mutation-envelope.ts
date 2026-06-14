import type {
  MoveDescriptor,
  MovePidGraphNode,
  NativeProcessImageRefusal,
  VmHandle,
} from "@machinen/runtime";
import { basename } from "node:path";
import type { MoveLoadDirectLoader } from "./move-rendezvous.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type MoveCapture = NonNullable<MoveResourcePlan["capture"]>;
type MoveMkdirState = NonNullable<MoveCapture["mkdirState"]>;
type MoveMkdirParentsState = NonNullable<MoveCapture["mkdirParentsState"]>;
type MoveTouchState = NonNullable<MoveCapture["touchState"]>;
type MoveChmodState = NonNullable<MoveCapture["chmodState"]>;
type MoveChownState = NonNullable<MoveCapture["chownState"]>;
type MoveLinkState = NonNullable<MoveCapture["linkState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveMkdirStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveCapture["mkdirState"]> {
  const targetPath = moveMkdirTargetPath(node);
  if (!targetPath) {
    return undefined;
  }
  const parentPath = dirnamePath(targetPath);
  const result = await vm.execRaw(moveMkdirPreflightCommand(targetPath, parentPath), {
    execTimeoutMs: 10_000,
  });
  const [modeLine, digestLine] = result.stdout.trim().split("\n");
  return result.exitCode === 0 &&
    /^[0-9a-f]+$/.test(modeLine ?? "") &&
    /^[0-9a-f]{64}$/.test(digestLine ?? "")
    ? {
        targetPath,
        parentPath,
        parentIdentity: { mode: modeLine as string, entriesDigest: digestLine as string },
        policy: "absent-child-existing-parent",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveMkdirParentsStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveCapture["mkdirParentsState"]> {
  const targetPath = moveMkdirParentsTargetPath(node);
  if (!targetPath) {
    return undefined;
  }
  const result = await vm.execRaw(moveMkdirParentsPreflightCommand(targetPath), {
    execTimeoutMs: 10_000,
  });
  const [existingPrefix, missingLine, modeLine, digestLine] = result.stdout.trim().split("\n");
  const missingComponents = missingLine ? missingLine.split("/").filter(Boolean) : [];
  return result.exitCode === 0 &&
    existingPrefix?.startsWith("/") &&
    missingComponents.every(isSafePathComponent) &&
    /^[0-9a-f]+$/.test(modeLine ?? "") &&
    /^[0-9a-f]{64}$/.test(digestLine ?? "")
    ? {
        targetPath,
        existingPrefix,
        missingComponents,
        prefixIdentity: { mode: modeLine as string, entriesDigest: digestLine as string },
        policy: "symlink-free-path-idempotent-or-create-missing",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveTouchStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveCapture["touchState"]> {
  const target = moveTouchTarget(node);
  if (!target) {
    return undefined;
  }
  const parentPath = dirnamePath(target.path);
  const result = await vm.execRaw(
    moveTouchPreflightCommand(target.path, parentPath, target.timestampSpec),
    { execTimeoutMs: 10_000 },
  );
  const [modeLine, digestLine, epochLine] = result.stdout.trim().split("\n");
  const expectedEpoch = Number(epochLine);
  return result.exitCode === 0 &&
    /^[0-9a-f]+$/.test(modeLine ?? "") &&
    /^[0-9a-f]{64}$/.test(digestLine ?? "") &&
    Number.isSafeInteger(expectedEpoch)
    ? {
        path: target.path,
        parentPath,
        timestampSpec: target.timestampSpec,
        expectedEpoch,
        parentIdentity: { mode: modeLine as string, entriesDigest: digestLine as string },
        policy: "deterministic-timestamp-absent-file-create",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveChmodStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveCapture["chmodState"]> {
  const target = moveChmodTarget(node);
  if (!target) {
    return undefined;
  }
  const result = await vm.execRaw(moveChmodPreflightCommand(target.path), {
    execTimeoutMs: 10_000,
  });
  const [expectedMode, sizeLine, shaLine] = result.stdout.trim().split("\n");
  const size = Number(sizeLine);
  return result.exitCode === 0 &&
    isNumericModeString(expectedMode) &&
    Number.isSafeInteger(size) &&
    /^[0-9a-f]{64}$/.test(shaLine ?? "")
    ? {
        path: target.path,
        expectedMode,
        targetMode: target.targetMode,
        fileIdentity: { size, sha256: shaLine as string },
        policy: "numeric-mode-regular-non-symlink",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveChownStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveCapture["chownState"]> {
  const target = moveChownTarget(node);
  if (!target) {
    return undefined;
  }
  const result = await vm.execRaw(
    moveChownPreflightCommand(target.path, target.owner, target.group),
    { execTimeoutMs: 10_000 },
  );
  const [targetUidLine, targetGidLine, expectedUidLine, expectedGidLine, sizeLine, shaLine] =
    result.stdout.trim().split("\n");
  const targetUid = Number(targetUidLine);
  const targetGid = Number(targetGidLine);
  const expectedUid = Number(expectedUidLine);
  const expectedGid = Number(expectedGidLine);
  const size = Number(sizeLine);
  return result.exitCode === 0 &&
    [targetUid, targetGid, expectedUid, expectedGid, size].every(Number.isSafeInteger) &&
    /^[0-9a-f]{64}$/.test(shaLine ?? "")
    ? {
        path: target.path,
        owner: target.owner,
        group: target.group,
        targetUid,
        targetGid,
        expectedUid,
        expectedGid,
        fileIdentity: { size, sha256: shaLine as string },
        policy: "same-base-uid-gid-regular-non-symlink",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function readMoveLinkStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveCapture["linkState"]> {
  const target = moveLinkTarget(node);
  if (!target) {
    return undefined;
  }
  const destinationParent = dirnamePath(target.destinationPath);
  const result = await vm.execRaw(
    moveLinkPreflightCommand(target.sourcePath, target.destinationPath, destinationParent),
    { execTimeoutMs: 10_000 },
  );
  const [sourceDev, sourceInode, sourceMode, sizeLine, shaLine, parentDev, parentMode, digestLine] =
    result.stdout.trim().split("\n");
  const size = Number(sizeLine);
  return result.exitCode === 0 &&
    sourceDev &&
    parentDev &&
    sourceDev === parentDev &&
    sourceInode &&
    /^[0-9a-f]+$/.test(sourceMode ?? "") &&
    Number.isSafeInteger(size) &&
    /^[0-9a-f]{64}$/.test(shaLine ?? "") &&
    /^[0-9a-f]+$/.test(parentMode ?? "") &&
    /^[0-9a-f]{64}$/.test(digestLine ?? "")
    ? {
        sourcePath: target.sourcePath,
        destinationPath: target.destinationPath,
        sourceIdentity: {
          dev: sourceDev,
          inode: sourceInode,
          mode: sourceMode as string,
          size,
          sha256: shaLine as string,
        },
        destinationParent,
        destinationParentIdentity: {
          dev: parentDev,
          mode: parentMode as string,
          entriesDigest: digestLine as string,
        },
        policy: "hardlink-regular-source-absent-destination-same-filesystem",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetLinkLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.linkState;
  const argv = [executable, state?.sourcePath ?? "", state?.destinationPath ?? ""];
  const result = await vm.execRaw(moveLinkLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "link-file");
  const refusals = moveNamedLoaderRefusals(patch, "target hardlink loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-link-file-loader",
    executable,
    argv,
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

export async function runMoveTargetChownLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.chownState;
  const argv = [executable, `${state?.owner ?? ""}:${state?.group ?? ""}`, state?.path ?? ""];
  const result = await vm.execRaw(moveChownLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "chown-file");
  const refusals = moveNamedLoaderRefusals(patch, "target chown loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-chown-file-loader",
    executable,
    argv,
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

export async function runMoveTargetChmodLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.chmodState;
  const argv = [executable, state?.targetMode ?? "", state?.path ?? ""];
  const result = await vm.execRaw(moveChmodLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "chmod-file");
  const refusals = moveNamedLoaderRefusals(patch, "target chmod loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-chmod-file-loader",
    executable,
    argv,
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

export async function runMoveTargetTouchLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.touchState;
  const argv = [executable, "-t", state?.timestampSpec ?? "", state?.path ?? ""];
  const result = await vm.execRaw(moveTouchLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "touch-file");
  const refusals = moveNamedLoaderRefusals(patch, "target touch loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-touch-file-loader",
    executable,
    argv,
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

export async function runMoveTargetMkdirParentsLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.mkdirParentsState;
  const argv = [executable, "-p", state?.targetPath ?? ""];
  const result = await vm.execRaw(moveMkdirParentsLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "mkdir-parents");
  const refusals = moveNamedLoaderRefusals(patch, "target mkdir -p loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-mkdir-parents-loader",
    executable,
    argv,
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

export async function runMoveTargetMkdirLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.mkdirState;
  const argv = [executable, state?.targetPath ?? ""];
  const result = await vm.execRaw(moveMkdirLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "mkdir-dir");
  const refusals = moveNamedLoaderRefusals(patch, "target mkdir loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-mkdir-dir-loader",
    executable,
    argv,
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveLinkTarget(
  node: MovePidGraphNode,
): { sourcePath: string; destinationPath: string } | undefined {
  if (moveCommandName(node) !== "ln" || node.argv.length !== 3) {
    return undefined;
  }
  const sourcePath = node.argv[1];
  const destinationPath = node.argv[2];
  return sourcePath?.startsWith("/") &&
    destinationPath?.startsWith("/") &&
    sourcePath !== "/" &&
    destinationPath !== "/" &&
    safeAbsolutePath(sourcePath) &&
    safeAbsolutePath(destinationPath) &&
    sourcePath !== destinationPath
    ? { sourcePath, destinationPath }
    : undefined;
}

function moveChownTarget(
  node: MovePidGraphNode,
): { path: string; owner: string; group: string } | undefined {
  if (moveCommandName(node) !== "chown" || node.argv.length !== 3) {
    return undefined;
  }
  const [owner, group, extra] = (node.argv[1] ?? "").split(":");
  const path = node.argv[2];
  return !extra &&
    isSafeUserOrGroup(owner) &&
    isSafeUserOrGroup(group) &&
    path?.startsWith("/") &&
    path !== "/" &&
    safeAbsolutePath(path)
    ? { path, owner, group }
    : undefined;
}

function moveChmodTarget(node: MovePidGraphNode): { path: string; targetMode: string } | undefined {
  if (moveCommandName(node) !== "chmod" || node.argv.length !== 3) {
    return undefined;
  }
  const targetMode = normalizeChmodMode(node.argv[1]);
  const path = node.argv[2];
  return targetMode && path?.startsWith("/") && path !== "/" && safeAbsolutePath(path)
    ? { path, targetMode }
    : undefined;
}

function moveTouchTarget(
  node: MovePidGraphNode,
): { path: string; timestampSpec: string } | undefined {
  if (moveCommandName(node) !== "touch" || node.argv.length !== 4 || node.argv[1] !== "-t") {
    return undefined;
  }
  const timestampSpec = node.argv[2];
  const path = node.argv[3];
  return isTouchTimestampSpec(timestampSpec) &&
    path?.startsWith("/") &&
    path !== "/" &&
    safeAbsolutePath(path)
    ? { path, timestampSpec }
    : undefined;
}

function moveMkdirParentsTargetPath(node: MovePidGraphNode): string | undefined {
  if (moveCommandName(node) !== "mkdir" || node.argv.length !== 3 || node.argv[1] !== "-p") {
    return undefined;
  }
  const targetPath = node.argv[2];
  return targetPath?.startsWith("/") && targetPath !== "/" && safeAbsolutePath(targetPath)
    ? targetPath
    : undefined;
}

function moveMkdirTargetPath(node: MovePidGraphNode): string | undefined {
  if (moveCommandName(node) !== "mkdir" || node.argv.length !== 2) {
    return undefined;
  }
  const targetPath = node.argv[1];
  return targetPath?.startsWith("/") && targetPath !== "/" && safeAbsolutePath(targetPath)
    ? targetPath
    : undefined;
}

function moveMkdirParentsPreflightCommand(targetPath: string): string {
  return `set -eu
target=${shellQuote(targetPath)}
case "$target" in /*) ;; *) exit 2;; esac
prefix=""
missing=""
existing="/"
rest=${shellQuote(targetPath.slice(1))}
old_ifs=$IFS
IFS=/
for component in $rest; do
  IFS=$old_ifs
  [ -n "$component" ] || exit 2
  [ "$component" != "." ] || exit 2
  [ "$component" != ".." ] || exit 2
  prefix="$prefix/$component"
  if [ -n "$missing" ]; then
    missing="$missing/$component"
  elif [ -L "$prefix" ]; then
    exit 2
  elif [ -e "$prefix" ]; then
    [ -d "$prefix" ] || exit 2
    existing="$prefix"
  else
    parent=${DOLLAR}{prefix%/*}
    [ -n "$parent" ] || parent=/
    [ -d "$parent" ] || exit 2
    [ ! -L "$parent" ] || exit 2
    missing="$component"
    existing="$parent"
  fi
  IFS=/
done
IFS=$old_ifs
[ -n "$existing" ] || exit 2
mode=$(stat -c %f "$existing")
entries=$(find "$existing" -mindepth 1 -maxdepth 1 -printf '%f\t%y\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')
printf '%s\n%s\n%s\n%s\n' "$existing" "$missing" "$mode" "$entries"
`;
}

function moveLinkPreflightCommand(
  sourcePath: string,
  destinationPath: string,
  destinationParent: string,
): string {
  return `set -eu
src=${shellQuote(sourcePath)}
dst=${shellQuote(destinationPath)}
parent=${shellQuote(destinationParent)}
[ -f "$src" ]
[ ! -L "$src" ]
[ -d "$parent" ]
[ ! -L "$parent" ]
[ ! -e "$dst" ]
source_dev=$(stat -c %d "$src")
source_inode=$(stat -c %i "$src")
source_mode=$(stat -c %f "$src")
source_size=$(stat -c %s "$src")
source_sha=$(sha256sum "$src" | awk '{print $1}')
parent_dev=$(stat -c %d "$parent")
parent_mode=$(stat -c %f "$parent")
entries=$(find "$parent" -mindepth 1 -maxdepth 1 -printf '%f\t%y\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')
[ "$source_dev" = "$parent_dev" ]
printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$source_dev" "$source_inode" "$source_mode" "$source_size" "$source_sha" "$parent_dev" "$parent_mode" "$entries"
`;
}

function moveChownPreflightCommand(path: string, owner: string, group: string): string {
  return `set -eu
path=${shellQuote(path)}
owner=${shellQuote(owner)}
group=${shellQuote(group)}
[ -f "$path" ]
[ ! -L "$path" ]
owner_line=$(getent passwd "$owner")
group_line=$(getent group "$group")
target_uid=$(printf '%s\n' "$owner_line" | cut -d: -f3)
target_gid=$(printf '%s\n' "$group_line" | cut -d: -f3)
expected_uid=$(stat -c %u "$path")
expected_gid=$(stat -c %g "$path")
size=$(stat -c %s "$path")
sha=$(sha256sum "$path" | awk '{print $1}')
printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$target_uid" "$target_gid" "$expected_uid" "$expected_gid" "$size" "$sha"
`;
}

function moveChmodPreflightCommand(path: string): string {
  return `set -eu
path=${shellQuote(path)}
[ -f "$path" ]
[ ! -L "$path" ]
mode=$(stat -c %a "$path")
size=$(stat -c %s "$path")
sha=$(sha256sum "$path" | awk '{print $1}')
printf '%s\n%s\n%s\n' "$mode" "$size" "$sha"
`;
}

function moveTouchPreflightCommand(
  path: string,
  parentPath: string,
  timestampSpec: string,
): string {
  return `set -eu
path=${shellQuote(path)}
parent=${shellQuote(parentPath)}
ts=${shellQuote(timestampSpec)}
[ -d "$parent" ]
[ ! -L "$parent" ]
[ ! -e "$path" ]
[ ! -L "$path" ]
year=$(printf '%s' "$ts" | cut -c1-4)
month=$(printf '%s' "$ts" | cut -c5-6)
day=$(printf '%s' "$ts" | cut -c7-8)
hour=$(printf '%s' "$ts" | cut -c9-10)
minute=$(printf '%s' "$ts" | cut -c11-12)
second=$(printf '%s' "$ts" | cut -d. -f2)
epoch=$(TZ=UTC date -d "$year-$month-$day $hour:$minute:$second" +%s)
mode=$(stat -c %f "$parent")
entries=$(find "$parent" -mindepth 1 -maxdepth 1 -printf '%f\t%y\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')
printf '%s\n%s\n%s\n' "$mode" "$entries" "$epoch"
`;
}

function moveMkdirPreflightCommand(targetPath: string, parentPath: string): string {
  return `set -eu
target=${shellQuote(targetPath)}
parent=${shellQuote(parentPath)}
[ -d "$parent" ]
[ ! -L "$parent" ]
[ ! -e "$target" ]
mode=$(stat -c %f "$parent")
entries=$(find "$parent" -mindepth 1 -maxdepth 1 -printf '%f\t%y\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')
printf '%s\n%s\n' "$mode" "$entries"
`;
}

function moveLinkLoaderCommand(executable: string, state: MoveLinkState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tlink-file\\trefused\\tmissing-link-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveLinkPreflightCommand(state.sourcePath, state.destinationPath, state.destinationParent)}} > /tmp/machinen-link-preflight-$$.txt
actual_source_dev=$(sed -n '1p' /tmp/machinen-link-preflight-$$.txt)
actual_source_inode=$(sed -n '2p' /tmp/machinen-link-preflight-$$.txt)
actual_source_mode=$(sed -n '3p' /tmp/machinen-link-preflight-$$.txt)
actual_source_size=$(sed -n '4p' /tmp/machinen-link-preflight-$$.txt)
actual_source_sha=$(sed -n '5p' /tmp/machinen-link-preflight-$$.txt)
actual_parent_dev=$(sed -n '6p' /tmp/machinen-link-preflight-$$.txt)
actual_parent_mode=$(sed -n '7p' /tmp/machinen-link-preflight-$$.txt)
actual_parent_digest=$(sed -n '8p' /tmp/machinen-link-preflight-$$.txt)
rm -f /tmp/machinen-link-preflight-$$.txt
if [ "$actual_source_mode" != ${shellQuote(state.sourceIdentity.mode)} ]; then
  printf 'PATCH\tlink-file\trefused\tchanged-source-identity\n'
  exit 2
fi
if [ "$actual_source_size" != ${shellQuote(String(state.sourceIdentity.size))} ] || [ "$actual_source_sha" != ${shellQuote(state.sourceIdentity.sha256)} ]; then
  printf 'PATCH\tlink-file\trefused\tchanged-source-content\n'
  exit 2
fi
if [ "$actual_source_dev" != "$actual_parent_dev" ] || [ "$actual_parent_mode" != ${shellQuote(state.destinationParentIdentity.mode)} ] || [ "$actual_parent_digest" != ${shellQuote(state.destinationParentIdentity.entriesDigest)} ]; then
  printf 'PATCH\tlink-file\trefused\tchanged-destination-parent\n'
  exit 2
fi
if ! ${shellQuote(executable)} ${shellQuote(state.sourcePath)} ${shellQuote(state.destinationPath)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tlink-file\trefused\tlink-failed\n'
  exit 2
fi
if [ -L ${shellQuote(state.destinationPath)} ] || [ ! -f ${shellQuote(state.destinationPath)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tlink-file\trefused\tunsafe-destination-after-link\n'
  exit 2
fi
post_src_dev=$(stat -c %d ${shellQuote(state.sourcePath)})
post_src_inode=$(stat -c %i ${shellQuote(state.sourcePath)})
post_dst_dev=$(stat -c %d ${shellQuote(state.destinationPath)})
post_dst_inode=$(stat -c %i ${shellQuote(state.destinationPath)})
post_dst_size=$(stat -c %s ${shellQuote(state.destinationPath)})
post_dst_sha=$(sha256sum ${shellQuote(state.destinationPath)} | awk '{print $1}')
if [ "$post_src_dev" != "$post_dst_dev" ] || [ "$post_src_inode" != "$post_dst_inode" ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tlink-file\trefused\tnot-hardlink-after-link\n'
  exit 2
fi
if [ "$post_dst_size" != ${shellQuote(String(state.sourceIdentity.size))} ] || [ "$post_dst_sha" != ${shellQuote(state.sourceIdentity.sha256)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tlink-file\trefused\tchanged-content-after-link\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-link-completed\n'
printf 'PATCH\tlink-file\tready\t%s\t%s\t%s\n' ${shellQuote(state.sourcePath)} ${shellQuote(state.destinationPath)} "$post_src_inode"
`;
}

function moveChownLoaderCommand(executable: string, state: MoveChownState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tchown-file\\trefused\\tmissing-chown-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveChownPreflightCommand(state.path, state.owner, state.group)}} > /tmp/machinen-chown-preflight-$$.txt
actual_target_uid=$(sed -n '1p' /tmp/machinen-chown-preflight-$$.txt)
actual_target_gid=$(sed -n '2p' /tmp/machinen-chown-preflight-$$.txt)
actual_uid=$(sed -n '3p' /tmp/machinen-chown-preflight-$$.txt)
actual_gid=$(sed -n '4p' /tmp/machinen-chown-preflight-$$.txt)
actual_size=$(sed -n '5p' /tmp/machinen-chown-preflight-$$.txt)
actual_sha=$(sed -n '6p' /tmp/machinen-chown-preflight-$$.txt)
rm -f /tmp/machinen-chown-preflight-$$.txt
if [ "$actual_target_uid" != ${shellQuote(String(state.targetUid))} ] || [ "$actual_target_gid" != ${shellQuote(String(state.targetGid))} ]; then
  printf 'PATCH\tchown-file\trefused\tchanged-uid-gid-mapping\n'
  exit 2
fi
if [ "$actual_uid" != ${shellQuote(String(state.expectedUid))} ] || [ "$actual_gid" != ${shellQuote(String(state.expectedGid))} ]; then
  printf 'PATCH\tchown-file\trefused\tchanged-input-owner\n'
  exit 2
fi
if [ "$actual_size" != ${shellQuote(String(state.fileIdentity.size))} ] || [ "$actual_sha" != ${shellQuote(state.fileIdentity.sha256)} ]; then
  printf 'PATCH\tchown-file\trefused\tchanged-input-identity\n'
  exit 2
fi
if ! ${shellQuote(executable)} ${shellQuote(`${state.owner}:${state.group}`)} ${shellQuote(state.path)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tchown-file\trefused\tchown-failed\n'
  exit 2
fi
if [ -L ${shellQuote(state.path)} ] || [ ! -f ${shellQuote(state.path)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tchown-file\trefused\tunsafe-target-after-chown\n'
  exit 2
fi
post_uid=$(stat -c %u ${shellQuote(state.path)})
post_gid=$(stat -c %g ${shellQuote(state.path)})
post_size=$(stat -c %s ${shellQuote(state.path)})
post_sha=$(sha256sum ${shellQuote(state.path)} | awk '{print $1}')
if [ "$post_uid" != ${shellQuote(String(state.targetUid))} ] || [ "$post_gid" != ${shellQuote(String(state.targetGid))} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tchown-file\trefused\tunexpected-target-owner\n'
  exit 2
fi
if [ "$post_size" != ${shellQuote(String(state.fileIdentity.size))} ] || [ "$post_sha" != ${shellQuote(state.fileIdentity.sha256)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tchown-file\trefused\tchanged-content-after-chown\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-chown-completed\n'
printf 'PATCH\tchown-file\tready\t%s\t%s\t%s\n' ${shellQuote(state.path)} ${shellQuote(String(state.targetUid))} ${shellQuote(String(state.targetGid))}
`;
}

function moveChmodLoaderCommand(executable: string, state: MoveChmodState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tchmod-file\\trefused\\tmissing-chmod-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveChmodPreflightCommand(state.path)}} > /tmp/machinen-chmod-preflight-$$.txt
actual_mode=$(sed -n '1p' /tmp/machinen-chmod-preflight-$$.txt)
actual_size=$(sed -n '2p' /tmp/machinen-chmod-preflight-$$.txt)
actual_sha=$(sed -n '3p' /tmp/machinen-chmod-preflight-$$.txt)
rm -f /tmp/machinen-chmod-preflight-$$.txt
if [ "$actual_mode" != ${shellQuote(state.expectedMode)} ]; then
  printf 'PATCH\tchmod-file\trefused\tchanged-input-mode\n'
  exit 2
fi
if [ "$actual_size" != ${shellQuote(String(state.fileIdentity.size))} ] || [ "$actual_sha" != ${shellQuote(state.fileIdentity.sha256)} ]; then
  printf 'PATCH\tchmod-file\trefused\tchanged-input-identity\n'
  exit 2
fi
if ! ${shellQuote(executable)} ${shellQuote(state.targetMode)} ${shellQuote(state.path)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tchmod-file\trefused\tchmod-failed\n'
  exit 2
fi
if [ -L ${shellQuote(state.path)} ] || [ ! -f ${shellQuote(state.path)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tchmod-file\trefused\tunsafe-target-after-chmod\n'
  exit 2
fi
post_mode=$(stat -c %a ${shellQuote(state.path)})
post_size=$(stat -c %s ${shellQuote(state.path)})
post_sha=$(sha256sum ${shellQuote(state.path)} | awk '{print $1}')
if [ "$post_mode" != ${shellQuote(state.targetMode)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tchmod-file\trefused\tunexpected-target-mode\n'
  exit 2
fi
if [ "$post_size" != ${shellQuote(String(state.fileIdentity.size))} ] || [ "$post_sha" != ${shellQuote(state.fileIdentity.sha256)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tchmod-file\trefused\tchanged-content-after-chmod\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-chmod-completed\n'
printf 'PATCH\tchmod-file\tready\t%s\t%s\t%s\n' ${shellQuote(state.path)} ${shellQuote(state.expectedMode)} ${shellQuote(state.targetMode)}
`;
}

function moveTouchLoaderCommand(executable: string, state: MoveTouchState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\ttouch-file\\trefused\\tmissing-touch-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveTouchPreflightCommand(state.path, state.parentPath, state.timestampSpec)}} > /tmp/machinen-touch-preflight-$$.txt
actual_mode=$(sed -n '1p' /tmp/machinen-touch-preflight-$$.txt)
actual_digest=$(sed -n '2p' /tmp/machinen-touch-preflight-$$.txt)
actual_epoch=$(sed -n '3p' /tmp/machinen-touch-preflight-$$.txt)
rm -f /tmp/machinen-touch-preflight-$$.txt
if [ "$actual_mode" != ${shellQuote(state.parentIdentity.mode)} ] || [ "$actual_digest" != ${shellQuote(state.parentIdentity.entriesDigest)} ]; then
  printf 'PATCH\ttouch-file\trefused\tchanged-parent-identity\n'
  exit 2
fi
if [ "$actual_epoch" != ${shellQuote(String(state.expectedEpoch))} ]; then
  printf 'PATCH\ttouch-file\trefused\tchanged-timestamp-policy\n'
  exit 2
fi
if ! TZ=UTC ${shellQuote(executable)} -t ${shellQuote(state.timestampSpec)} ${shellQuote(state.path)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\ttouch-file\trefused\ttouch-failed\n'
  exit 2
fi
if [ ! -f ${shellQuote(state.path)} ] || [ -L ${shellQuote(state.path)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\ttouch-file\trefused\tunsafe-created-path\n'
  exit 2
fi
actual_created_epoch=$(stat -c %Y ${shellQuote(state.path)})
if [ "$actual_created_epoch" != ${shellQuote(String(state.expectedEpoch))} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\ttouch-file\trefused\tunexpected-created-timestamp\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-touch-completed\n'
printf 'PATCH\ttouch-file\tready\t%s\t%s\n' ${shellQuote(state.path)} ${shellQuote(String(state.expectedEpoch))}
`;
}

function moveMkdirParentsLoaderCommand(
  executable: string,
  state: MoveMkdirParentsState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tmkdir-parents\\trefused\\tmissing-mkdir-parents-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveMkdirParentsPreflightCommand(state.targetPath)}} > /tmp/machinen-mkdir-parents-preflight-$$.txt
actual_prefix=$(sed -n '1p' /tmp/machinen-mkdir-parents-preflight-$$.txt)
actual_missing=$(sed -n '2p' /tmp/machinen-mkdir-parents-preflight-$$.txt)
actual_mode=$(sed -n '3p' /tmp/machinen-mkdir-parents-preflight-$$.txt)
actual_digest=$(sed -n '4p' /tmp/machinen-mkdir-parents-preflight-$$.txt)
rm -f /tmp/machinen-mkdir-parents-preflight-$$.txt
if [ "$actual_prefix" != ${shellQuote(state.existingPrefix)} ] || [ "$actual_missing" != ${shellQuote(state.missingComponents.join("/"))} ]; then
  printf 'PATCH\tmkdir-parents\trefused\tchanged-path-chain\n'
  exit 2
fi
if [ "$actual_mode" != ${shellQuote(state.prefixIdentity.mode)} ] || [ "$actual_digest" != ${shellQuote(state.prefixIdentity.entriesDigest)} ]; then
  printf 'PATCH\tmkdir-parents\trefused\tchanged-prefix-identity\n'
  exit 2
fi
if ! ${shellQuote(executable)} -p ${shellQuote(state.targetPath)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tmkdir-parents\trefused\tmkdir-parents-failed\n'
  exit 2
fi
if find ${shellQuote(state.targetPath)} -type l -print -quit | grep -q .; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tmkdir-parents\trefused\tcreated-symlink\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-mkdir-parents-completed\n'
printf 'PATCH\tmkdir-parents\tready\t%s\t%s\t%s\n' ${shellQuote(state.targetPath)} ${shellQuote(state.existingPrefix)} ${shellQuote(state.missingComponents.join("/"))}
`;
}

function moveMkdirLoaderCommand(executable: string, state: MoveMkdirState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tmkdir-dir\\trefused\\tmissing-mkdir-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveMkdirPreflightCommand(state.targetPath, state.parentPath)}} > /tmp/machinen-mkdir-preflight-$$.txt
actual_mode=$(sed -n '1p' /tmp/machinen-mkdir-preflight-$$.txt)
actual_digest=$(sed -n '2p' /tmp/machinen-mkdir-preflight-$$.txt)
rm -f /tmp/machinen-mkdir-preflight-$$.txt
if [ "$actual_mode" != ${shellQuote(state.parentIdentity.mode)} ] || [ "$actual_digest" != ${shellQuote(state.parentIdentity.entriesDigest)} ]; then
  printf 'PATCH\tmkdir-dir\trefused\tchanged-parent-identity\n'
  exit 2
fi
if ! ${shellQuote(executable)} ${shellQuote(state.targetPath)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tmkdir-dir\trefused\tmkdir-failed\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-mkdir-completed\n'
printf 'PATCH\tmkdir-dir\tready\t%s\t%s\n' ${shellQuote(state.targetPath)} ${shellQuote(state.parentPath)}
`;
}

function dirnamePath(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function moveNamedPatchFromOutput(
  result: { stdout: string; stderr: string; exitCode: number },
  patchName: string,
): MovePatch {
  const state =
    result.exitCode === 0 && result.stdout.includes(`PATCH\t${patchName}\tready`)
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

function moveNamedLoaderRefusals(
  patch: MovePatch | undefined,
  message: string,
): NativeProcessImageRefusal[] {
  return patch?.state === "ready"
    ? []
    : [{ code: "target-process-context-unsupported", message, detail: { patch } }];
}

function parseLogPath(stdout: string): string | undefined {
  return stdout
    .trim()
    .split("\n")
    .find((row) => row.startsWith("LOAD_LOG\t"))
    ?.split("\t")[1];
}

function moveRendezvousExecutable(descriptor: MoveDescriptor): string {
  return (
    descriptor.resourcePlan?.capture?.executablePackage?.path ??
    descriptor.nodes[0]?.exe ??
    "/usr/bin/mkdir"
  );
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.argv[0] ?? node.command ?? node.exe);
}

function safeAbsolutePath(path: string): boolean {
  return path.split("/").filter(Boolean).every(isSafePathComponent);
}

function isSafePathComponent(component: string): boolean {
  return component !== "." && component !== ".." && !component.includes("\0");
}

function isSafeUserOrGroup(value: string | undefined): value is string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value ?? "");
}

function isTouchTimestampSpec(value: string | undefined): value is string {
  return /^\d{12}\.\d{2}$/.test(value ?? "");
}

function normalizeChmodMode(value: string | undefined): string | undefined {
  if (!/^[0-7]{3,4}$/.test(value ?? "")) {
    return undefined;
  }
  return value?.length === 4 && value.startsWith("0") ? value.slice(1) : value;
}

function isNumericModeString(value: string | undefined): value is string {
  return /^[0-7]{3,4}$/.test(value ?? "");
}

const DOLLAR = "$";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
