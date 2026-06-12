import type { MoveDescriptor } from "@machinen/runtime";

import type { GenericPreflight } from "./move-generic-wave2-baseline.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];
type GenericResource = MoveResourcePlan["resources"][number];

type EventfdDescriptor = NonNullable<GenericState>["eventfds"][number];
type EpollDescriptor = NonNullable<GenericState>["epolls"][number];
type GenericResourceClass = NonNullable<GenericState>["resourceClasses"][number];

export function genericEventfds(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): EventfdDescriptor[] {
  return resourcePlan.resources
    .filter((resource) => resource.kind === "eventfd" && resource.fd !== undefined)
    .map((resource) => {
      const eventfd = preflight.eventfds.find((item) => item.fd === resource.fd);
      const flags = resource.flags ?? [];
      return {
        fd: resource.fd!,
        path: "anon_inode:[eventfd]" as const,
        counter: eventfd?.counter ?? stringRecipeValue(resource, "eventfdCounter") ?? "unknown",
        fdinfoFlags: eventfd?.fdinfoFlags ?? stringRecipeValue(resource, "fdinfoFlags"),
        flags,
        semaphore: flags.includes("EFD_SEMAPHORE"),
        nonblocking: flags.includes("O_NONBLOCK"),
        cloexec: flags.includes("FD_CLOEXEC"),
        support: supportedEventfdCounter(resource, preflight, resourcePlan)
          ? ("target-native-counter" as const)
          : ("refused-baseline" as const),
      };
    });
}

export function genericEpolls(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): EpollDescriptor[] {
  return resourcePlan.resources
    .filter((resource) => resource.kind === "epoll" && resource.fd !== undefined)
    .map((resource) => {
      const epoll = preflight.epolls.find((item) => item.fd === resource.fd);
      const watchedFds = epoll?.watchedFds ?? recipeEpollWatches(resource);
      return {
        fd: resource.fd!,
        path: "anon_inode:[eventpoll]" as const,
        fdinfoFlags: epoll?.fdinfoFlags ?? stringRecipeValue(resource, "fdinfoFlags"),
        flags: resource.flags ?? [],
        watchedFds: watchedFds.map((watch) => ({
          targetFd: watch.targetFd,
          events: watch.events,
          data: watch.data,
          trigger: epollTriggerMode(watch.events),
          oneShot: epollHasEvent(watch.events, 1 << 30),
          watchedResourceClass: watchedResourceClass(resourcePlan.resources, watch.targetFd),
        })),
        support: supportedEpollSet(resource, preflight, resourcePlan)
          ? ("target-native-eventfd-watch" as const)
          : ("refused-baseline" as const),
      };
    });
}

export function genericAnonInodeResourceClasses(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): GenericResourceClass[] {
  const classes: GenericResourceClass[] = [];
  const eventfds = genericEventfds(preflight, resourcePlan);
  if (eventfds.length > 0) {
    const supported = eventfds.filter((item) => item.support === "target-native-counter");
    classes.push({
      resourceClass: supported.length > 0 ? "eventfdCounter" : "eventfdBaseline",
      status: supported.length > 0 ? "supported" : "refused",
      evidence: `eventfd counters recorded for fds=${eventfds.map((item) => item.fd).join(",")}`,
    });
  }
  const epolls = genericEpolls(preflight, resourcePlan);
  if (epolls.length > 0) {
    const supported = epolls.filter((item) => item.support === "target-native-eventfd-watch");
    classes.push({
      resourceClass: supported.length > 0 ? "epollEventfdWatch" : "epollBaseline",
      status: supported.length > 0 ? "supported" : "refused",
      evidence: `epoll watched fd sets recorded for fds=${epolls.map((item) => item.fd).join(",")}`,
    });
  }
  return classes;
}

export function supportedEpollSet(
  resource: GenericResource,
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): boolean {
  if (resource.kind !== "epoll" || resource.fd === undefined) {
    return false;
  }
  if (resourcePlan.resources.filter((item) => item.kind === "epoll").length !== 1) {
    return false;
  }
  const epoll = preflight.epolls.find((item) => item.fd === resource.fd);
  const fdinfoFlags = epoll?.fdinfoFlags ?? stringRecipeValue(resource, "fdinfoFlags");
  const watchedFds = epoll?.watchedFds ?? recipeEpollWatches(resource);
  if (fdinfoFlags !== "02" || watchedFds.length !== 1) {
    return false;
  }
  const watch = watchedFds[0]!;
  const trigger = epollTriggerMode(watch.events);
  if (trigger !== "level" || epollHasEvent(watch.events, 1 << 30)) {
    return false;
  }
  const watched = resourcePlan.resources.find((item) => item.fd === watch.targetFd);
  if (!watched || watched.kind === "epoll" || watched.kind !== "eventfd") {
    return false;
  }
  const capture = resourcePlan.capture;
  const active = `${capture?.wchan ?? ""} ${capture?.syscall ?? ""}`.toLowerCase();
  return (
    !/(epoll|poll|select)/.test(active) && supportedEventfdCounter(watched, preflight, resourcePlan)
  );
}

export function supportedEventfdCounter(
  resource: GenericResource,
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): boolean {
  if (resource.kind !== "eventfd" || resource.fd === undefined) {
    return false;
  }
  if (resourcePlan.resources.filter((item) => item.kind === "eventfd").length !== 1) {
    return false;
  }
  const eventfd = preflight.eventfds.find((item) => item.fd === resource.fd);
  const counter = eventfd?.counter ?? stringRecipeValue(resource, "eventfdCounter") ?? "unknown";
  const fdinfoFlags = eventfd?.fdinfoFlags ?? stringRecipeValue(resource, "fdinfoFlags");
  if (fdinfoFlags !== "02" || resource.flags?.some((flag) => flag !== "octal:02")) {
    return false;
  }
  if (!supportedCounter(counter)) {
    return false;
  }
  const capture = resourcePlan.capture;
  const active = `${capture?.wchan ?? ""} ${capture?.syscall ?? ""}`.toLowerCase();
  return !/(eventfd|epoll|poll|select)/.test(active) && !/^(0|63)\s/.test(capture?.syscall ?? "");
}

function supportedCounter(counter: string): boolean {
  if (!/^[0-9a-fA-F]+$/.test(counter)) {
    return false;
  }
  const value = BigInt(`0x${counter}`);
  return value >= 0n && value <= 0xffffffffn;
}

function stringRecipeValue(resource: GenericResource, key: string): string | undefined {
  const value = resource.recipe?.[key];
  return typeof value === "string" ? value : undefined;
}

function recipeEpollWatches(resource: GenericResource): Array<{
  targetFd: number;
  events: string;
  data: string;
}> {
  return Array.isArray(resource.recipe?.epollWatchedFds)
    ? resource.recipe.epollWatchedFds.flatMap((item) => {
        if (!isRecipeWatch(item)) {
          return [];
        }
        return [{ targetFd: item.targetFd, events: item.events, data: item.data }];
      })
    : [];
}

function isRecipeWatch(item: unknown): item is { targetFd: number; events: string; data: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as { targetFd?: unknown }).targetFd === "number" &&
    typeof (item as { events?: unknown }).events === "string" &&
    typeof (item as { data?: unknown }).data === "string"
  );
}

function watchedResourceClass(resources: GenericResource[], fd: number): string {
  const resource = resources.find((item) => item.fd === fd);
  if (!resource) {
    return "unknown";
  }
  return resource.kind === "timer" ? "timerfd" : resource.kind;
}

function epollTriggerMode(events: string): "level" | "edge" | "unknown" {
  const parsed = Number.parseInt(events, 16);
  if (!Number.isFinite(parsed)) {
    return "unknown";
  }
  return parsed & (1 << 31) ? "edge" : "level";
}

function epollHasEvent(events: string, bit: number): boolean {
  const parsed = Number.parseInt(events, 16);
  return Number.isFinite(parsed) && (parsed & bit) !== 0;
}
