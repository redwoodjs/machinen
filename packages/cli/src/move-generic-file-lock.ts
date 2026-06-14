import type { MoveDescriptor } from "@machinen/runtime";

import { shellQuote } from "./move-preflight-helpers.ts";
import type { GenericPreflight } from "./move-generic-wave2-baseline.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];
type GenericFileLock = NonNullable<GenericState>["fileLocks"][number];
type GenericResourceClass = NonNullable<GenericState>["resourceClasses"][number];
type GenericRefusalClass = NonNullable<GenericState>["refusalClasses"][number];

export function genericFileLocks(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): GenericFileLock[] {
  const recipeLocks = recipeFileLocks(resourcePlan);
  if (recipeLocks.length > 0) {
    return recipeLocks;
  }
  return preflight.locks.map((line) => ({
    path: lockPath(line),
    lockType: "posix" as const,
    mode: "exclusive" as const,
    range: { start: 0, length: "eof" as const },
    owner: { policy: "refused-unknown-owner" as const },
    fileIdentity: { size: 0, sha256: "unknown" },
    conflictPolicy: "must-acquire-nonblocking-before-launch" as const,
    support: "refused-baseline" as const,
  }));
}

export function genericFileLockResourceClasses(locks: GenericFileLock[]): GenericResourceClass[] {
  if (locks.length === 0) {
    return [];
  }
  const supported = locks.some((lock) => lock.support === "target-native-advisory-lock");
  return [
    {
      resourceClass: supported ? "fileLockAdvisory" : "fileLock",
      status: supported ? "supported" : "refused",
      evidence: `file lock descriptors recorded for paths=${locks.map((lock) => lock.path).join(",")}`,
    },
  ];
}

export function fileLockRefusals(locks: GenericFileLock[]): GenericRefusalClass[] {
  return locks.some((lock) => lock.support !== "target-native-advisory-lock")
    ? [
        {
          resourceClass: "fileLock",
          status: "refused",
          reason: "regular-file locks cannot be generically reconstructed for this shape",
          evidence: JSON.stringify(locks),
          nextAction: "model exact advisory lock type, owner, range, identity, and conflict policy",
        },
      ]
    : [];
}

export function genericFileLockLaunchCommand(state: NonNullable<GenericState>): string | undefined {
  const locks =
    state.fileLocks?.filter((lock) => lock.support === "target-native-advisory-lock") ?? [];
  if (locks.length === 0) {
    return undefined;
  }
  const spec = JSON.stringify({ argv: state.argv, locks });
  return `pid=$(python3 - ${shellQuote(spec)} "$log" <<'PY'
import fcntl, json, os, sys
spec = json.loads(sys.argv[1])
log_path = sys.argv[2]
held = []
for lock in spec['locks']:
    flags = os.O_RDWR
    fd = os.open(lock['path'], flags)
    op = fcntl.LOCK_EX if lock['mode'] == 'exclusive' else fcntl.LOCK_SH
    if lock['lockType'] == 'flock':
        fcntl.flock(fd, op | fcntl.LOCK_NB)
    else:
        fcntl.lockf(fd, op | fcntl.LOCK_NB, 0 if lock['range']['length'] == 'eof' else int(lock['range']['length']), int(lock['range']['start']))
    target_fd = lock.get('fd')
    if target_fd is not None:
        os.dup2(fd, int(target_fd), inheritable=True)
        # Keep the original fd open too: closing any fd for a record-locked file can release
        # process-owned locks on that inode.
        held.append(int(target_fd))
    else:
        os.set_inheritable(fd, True)
        held.append(fd)
log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
pid = os.fork()
if pid == 0:
    os.dup2(log_fd, 1)
    os.dup2(log_fd, 2)
    if log_fd not in (1, 2):
        os.close(log_fd)
    os.execvp(spec['argv'][0], spec['argv'])
print(pid)
PY
)`;
}

function recipeFileLocks(resourcePlan: MoveResourcePlan): GenericFileLock[] {
  const locks = resourcePlan.capture?.genericResourceGraphState?.fileLocks;
  if (locks?.length) {
    return locks;
  }
  return resourcePlan.resources.flatMap((resource) => {
    const recipe = resource.recipe ?? {};
    return recipe.fileLockModel === "advisory-v1" && typeof resource.path === "string"
      ? [recipeFileLock(resource.path, resource.fd, recipe)]
      : [];
  });
}

function recipeFileLock(
  path: string,
  fd: number | undefined,
  recipe: Record<string, unknown>,
): GenericFileLock {
  return {
    fd,
    path,
    lockType: recipe.fileLockType === "flock" ? "flock" : "posix",
    mode: recipe.fileLockMode === "shared" ? "shared" : "exclusive",
    range: { start: numericRecipeValue(recipe, "fileLockStart") ?? 0, length: "eof" },
    owner: { pid: numericRecipeValue(recipe, "fileLockOwnerPid"), policy: "target-process" },
    fileIdentity: {
      size: numericRecipeValue(recipe, "fileLockFileSize") ?? 0,
      sha256: stringRecipeValue(recipe, "fileLockSha256") ?? "unknown",
    },
    conflictPolicy: "must-acquire-nonblocking-before-launch",
    support: "target-native-advisory-lock",
  };
}

function numericRecipeValue(recipe: Record<string, unknown>, key: string): number | undefined {
  const value = recipe[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function stringRecipeValue(recipe: Record<string, unknown>, key: string): string | undefined {
  const value = recipe[key];
  return typeof value === "string" ? value : undefined;
}

function lockPath(line: string): string {
  const match = line.match(/path=([^\s]+)/);
  return match?.[1] ?? "unknown";
}
