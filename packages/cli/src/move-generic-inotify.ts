import type { MoveDescriptor } from "@machinen/runtime";

import type { GenericPreflight } from "./move-generic-wave2-baseline.ts";
import { shellQuote } from "./move-preflight-helpers.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];
type GenericResource = MoveResourcePlan["resources"][number];
type GenericResourceClass = NonNullable<GenericState>["resourceClasses"][number];
type InotifyDescriptor = NonNullable<NonNullable<GenericState>["inotifyWatches"]>[number];
type InotifyWatch = InotifyDescriptor["watches"][number];

export function genericInotifyWatches(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): InotifyDescriptor[] {
  return resourcePlan.resources
    .filter((resource) => inotifyResource(resource) && resource.fd !== undefined)
    .map((resource) => {
      const inotify = preflight.inotifies.find((item) => item.fd === resource.fd);
      const watches = inotifyWatchRecipe(resource, inotify);
      const supported = supportedInotifyFileFollow(resource, preflight, resourcePlan);
      return {
        fd: resource.fd!,
        path: "anon_inode:[inotify]" as const,
        fdinfoFlags: inotify?.fdinfoFlags ?? stringRecipeValue(resource, "fdinfoFlags"),
        flags: resource.flags ?? [],
        watches,
        eventPolicy: supported
          ? ("future-events-only-no-queue-replay" as const)
          : ("refused-baseline" as const),
        support: supported ? ("target-native-file-follow" as const) : ("refused-baseline" as const),
      };
    });
}

export function genericInotifyResourceClasses(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): GenericResourceClass[] {
  const watches = genericInotifyWatches(preflight, resourcePlan);
  if (watches.length === 0) {
    return [];
  }
  const supported = watches.some((item) => item.support === "target-native-file-follow");
  return [
    {
      resourceClass: supported ? "inotifyFileFollow" : "inotifyBaseline",
      status: supported ? "supported" : "refused",
      evidence: `inotify watch descriptors recorded for fds=${watches.map((item) => item.fd).join(",")}`,
    },
  ];
}

export function supportedInotifyFileFollow(
  resource: GenericResource,
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): boolean {
  if (!inotifyResource(resource) || resource.fd === undefined) {
    return false;
  }
  if (resourcePlan.resources.filter(inotifyResource).length !== 1) {
    return false;
  }
  const inotify = preflight.inotifies.find((item) => item.fd === resource.fd);
  const fdinfoFlags = inotify?.fdinfoFlags ?? stringRecipeValue(resource, "fdinfoFlags");
  const watches = inotifyWatchRecipe(resource, inotify);
  const capture = resourcePlan.capture;
  const active = `${capture?.wchan ?? ""} ${capture?.syscall ?? ""}`.toLowerCase();
  return (
    fdinfoFlags === "00" &&
    !resource.flags?.some((flag) => flag !== "octal:00") &&
    watches.length === 1 &&
    supportedWatch(watches[0]!) &&
    !/(inotify|epoll|poll|select)/.test(active)
  );
}

export function genericInotifyPreflightCommands(state: NonNullable<GenericState>): string[] {
  return (state.inotifyWatches ?? [])
    .filter((item) => item.support === "target-native-file-follow")
    .flatMap((item) =>
      item.watches.map((watch) => {
        const path = shellQuote(watch.path);
        return `test -f ${path} || fail inotify-watch-missing\n[ "$(stat -c '%s' ${path})" = ${shellQuote(String(watch.fileIdentity.size))} ] || fail inotify-watch-size-mismatch\n[ "$(sha256sum ${path} | cut -d' ' -f1)" = ${shellQuote(watch.fileIdentity.sha256)} ] || fail inotify-watch-identity-mismatch`;
      }),
    );
}

export function genericInotifyLaunchCommand(state: NonNullable<GenericState>): string | undefined {
  const inotifyWatches =
    state.inotifyWatches?.filter((item) => item.support === "target-native-file-follow") ?? [];
  if (inotifyWatches.length === 0) {
    return undefined;
  }
  const spec = JSON.stringify({ argv: state.argv, inotifyWatches });
  return `pid=$(python3 - ${shellQuote(spec)} "$log" <<'PY'
import ctypes, errno, json, os, sys
spec = json.loads(sys.argv[1])
log_path = sys.argv[2]
libc = ctypes.CDLL(None, use_errno=True)
for descriptor in spec['inotifyWatches']:
    fd = libc.inotify_init1(0)
    if fd < 0:
        raise OSError(ctypes.get_errno(), 'inotify_init1 failed')
    for watch in descriptor['watches']:
        mask = int(str(watch['mask']), 16)
        wd = libc.inotify_add_watch(fd, os.fsencode(watch['path']), mask)
        if wd < 0:
            raise OSError(ctypes.get_errno(), 'inotify_add_watch failed')
    target_fd = descriptor.get('fd')
    if target_fd is not None:
        os.dup2(fd, int(target_fd), inheritable=True)
        fd = int(target_fd)
    os.set_inheritable(fd, True)
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

function supportedWatch(watch: InotifyWatch): boolean {
  const mask = Number.parseInt(watch.mask, 16);
  return (
    Number.isFinite(mask) &&
    mask === 0x2 &&
    watch.ignoredMask === "0" &&
    watch.eventPolicy === "future-events-only-no-queue-replay" &&
    watch.fileIdentity.sha256 !== "unknown" &&
    watch.fileIdentity.size >= 0
  );
}

function inotifyWatchRecipe(
  resource: GenericResource,
  inotify: GenericPreflight["inotifies"][number] | undefined,
): InotifyWatch[] {
  const recipeWatches = Array.isArray(resource.recipe?.inotifyWatches)
    ? resource.recipe.inotifyWatches.flatMap((item) => (isRecipeWatch(item) ? [item] : []))
    : [];
  if (recipeWatches.length > 0) {
    return recipeWatches.map((item) => ({
      wd: item.wd,
      path: item.path,
      mask: normalizeHex(item.mask),
      ignoredMask: normalizeHex(item.ignoredMask),
      fileIdentity: item.fileIdentity,
      eventPolicy: "future-events-only-no-queue-replay" as const,
    }));
  }
  return (inotify?.watches ?? []).map((watch) => ({
    wd: watch.wd,
    path: watch.path ?? "unknown",
    mask: normalizeHex(watch.mask),
    ignoredMask: normalizeHex(watch.ignoredMask),
    fileIdentity: { size: 0, sha256: "unknown" },
    eventPolicy: "refused-baseline" as const,
  }));
}

function inotifyResource(resource: GenericResource): boolean {
  return resource.path === "anon_inode:inotify" || resource.path === "anon_inode:[inotify]";
}

function stringRecipeValue(resource: GenericResource, key: string): string | undefined {
  const value = resource.recipe?.[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeHex(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
}

function isRecipeWatch(item: unknown): item is {
  wd: number;
  path: string;
  mask: string;
  ignoredMask: string;
  fileIdentity: { size: number; sha256: string };
} {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const candidate = item as {
    wd?: unknown;
    path?: unknown;
    mask?: unknown;
    ignoredMask?: unknown;
    fileIdentity?: { size?: unknown; sha256?: unknown };
  };
  return (
    typeof candidate.wd === "number" &&
    typeof candidate.path === "string" &&
    typeof candidate.mask === "string" &&
    typeof candidate.ignoredMask === "string" &&
    typeof candidate.fileIdentity?.size === "number" &&
    typeof candidate.fileIdentity.sha256 === "string"
  );
}
