import type { MoveDescriptor } from "@machinen/runtime";

import type { GenericPreflight } from "./move-generic-wave2-baseline.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];
type GenericResource = MoveResourcePlan["resources"][number];

type EventfdDescriptor = NonNullable<GenericState>["eventfds"][number];
type EpollDescriptor = NonNullable<GenericState>["epolls"][number];
type EpollWatchDescriptor = EpollDescriptor["watchedFds"][number];
type TimerfdDescriptor = NonNullable<GenericState>["timers"][number];
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
        support: epollSupport(resource, preflight, resourcePlan),
      };
    });
}

export function genericTimers(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): TimerfdDescriptor[] {
  return resourcePlan.resources
    .filter((resource) => resource.kind === "timer" && resource.fd !== undefined)
    .map((resource) => {
      const timer = preflight.timers.find((item) => item.fd === resource.fd);
      const recipe = timerfdRecipe(resource, timer);
      const supported = supportedTimerfd(resource, preflight, resourcePlan);
      return {
        fd: resource.fd!,
        path: "anon_inode:[timerfd]" as const,
        fdinfoFlags: recipe.fdinfoFlags,
        flags: resource.flags ?? [],
        clockId: recipe.clockId,
        ticks: recipe.ticks,
        settimeFlags: recipe.settimeFlags,
        valueSeconds: recipe.valueSeconds,
        valueNanoseconds: recipe.valueNanoseconds,
        intervalSeconds: recipe.intervalSeconds,
        intervalNanoseconds: recipe.intervalNanoseconds,
        restartPolicy: supported
          ? ("monotonic-relative-oneshot-target-native" as const)
          : ("refused-baseline" as const),
        boundedSkewMilliseconds: 750,
        support: supported
          ? ("target-native-relative-oneshot" as const)
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
    classes.push({
      ...epollResourceClass(epolls),
      evidence: `epoll watched fd sets recorded for fds=${epolls.map((item) => item.fd).join(",")}`,
    });
  }
  const timers = genericTimers(preflight, resourcePlan);
  if (timers.length > 0) {
    const supported = timers.filter((item) => item.support === "target-native-relative-oneshot");
    classes.push({
      resourceClass: supported.length > 0 ? "timerfdRelativeOneShot" : "timerfdBaseline",
      status: supported.length > 0 ? "supported" : "refused",
      evidence: `timerfd clock/deadline state recorded for fds=${timers.map((item) => item.fd).join(",")}`,
    });
  }
  return classes;
}

function epollResourceClass(
  epolls: EpollDescriptor[],
): Pick<GenericResourceClass, "resourceClass" | "status"> {
  if (epolls.some((item) => item.support === "target-native-timerfd-watch")) {
    return { resourceClass: "epollTimerfdWatch", status: "supported" };
  }
  if (epolls.some((item) => item.support === "target-native-eventfd-watch")) {
    return { resourceClass: "epollEventfdWatch", status: "supported" };
  }
  return { resourceClass: "epollBaseline", status: "refused" };
}

export function supportedTimerfd(
  resource: GenericResource,
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): boolean {
  if (resource.kind !== "timer" || resource.fd === undefined) {
    return false;
  }
  if (resourcePlan.resources.filter((item) => item.kind === "timer").length !== 1) {
    return false;
  }
  const timer = preflight.timers.find((item) => item.fd === resource.fd);
  const recipe = timerfdRecipe(resource, timer);
  return (
    timerfdHasSupportedFlags(resource, recipe) &&
    timerfdIsMonotonicRelativeOneShot(recipe) &&
    timerfdValueIsBounded(recipe) &&
    !activeTimerfdWait(resourcePlan)
  );
}

export function supportedEpollSet(
  resource: GenericResource,
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): boolean {
  return epollSupport(resource, preflight, resourcePlan) !== "refused-baseline";
}

function epollSupport(
  resource: GenericResource,
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): EpollDescriptor["support"] {
  if (!basicEpollShapeIsSupported(resource, preflight, resourcePlan)) {
    return "refused-baseline";
  }
  const watch = (preflight.epolls.find((item) => item.fd === resource.fd)?.watchedFds ??
    recipeEpollWatches(resource))[0]!;
  return watchedResourceEpollSupport(watch.targetFd, preflight, resourcePlan);
}

function basicEpollShapeIsSupported(
  resource: GenericResource,
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): boolean {
  return (
    resource.kind === "epoll" &&
    resource.fd !== undefined &&
    resourcePlan.resources.filter((item) => item.kind === "epoll").length === 1 &&
    epollFdinfoShapeIsSupported(resource, preflight) &&
    !captureIsInActivePoll(resourcePlan)
  );
}

function epollFdinfoShapeIsSupported(
  resource: GenericResource,
  preflight: GenericPreflight,
): boolean {
  const epoll = preflight.epolls.find((item) => item.fd === resource.fd);
  const fdinfoFlags = epoll?.fdinfoFlags ?? stringRecipeValue(resource, "fdinfoFlags");
  const watchedFds = epoll?.watchedFds ?? recipeEpollWatches(resource);
  return fdinfoFlags === "02" && watchedFds.length === 1 && epollWatchIsLevelReady(watchedFds[0]);
}

function epollWatchIsLevelReady(watch: Pick<EpollWatchDescriptor, "events"> | undefined): boolean {
  return (
    watch !== undefined &&
    epollTriggerMode(watch.events) === "level" &&
    !epollHasEvent(watch.events, 1 << 30)
  );
}

function captureIsInActivePoll(resourcePlan: MoveResourcePlan): boolean {
  const capture = resourcePlan.capture;
  const active = `${capture?.wchan ?? ""} ${capture?.syscall ?? ""}`.toLowerCase();
  return /(epoll|poll|select)/.test(active);
}

function watchedResourceEpollSupport(
  targetFd: number,
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): EpollDescriptor["support"] {
  const watched = resourcePlan.resources.find((item) => item.fd === targetFd);
  if (watched?.kind === "eventfd" && supportedEventfdCounter(watched, preflight, resourcePlan)) {
    return "target-native-eventfd-watch";
  }
  if (watched?.kind === "timer" && supportedTimerfd(watched, preflight, resourcePlan)) {
    return "target-native-timerfd-watch";
  }
  return "refused-baseline";
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

type TimerfdRecipe = {
  fdinfoFlags: string | undefined;
  clockId: number | "unknown";
  ticks: string;
  settimeFlags: number | "unknown";
  valueSeconds: number;
  valueNanoseconds: number;
  intervalSeconds: number;
  intervalNanoseconds: number;
};

function timerfdHasSupportedFlags(resource: GenericResource, recipe: TimerfdRecipe): boolean {
  return recipe.fdinfoFlags === "02" && !resource.flags?.some((flag) => flag !== "octal:02");
}

function timerfdIsMonotonicRelativeOneShot(recipe: TimerfdRecipe): boolean {
  return (
    recipe.clockId === 1 &&
    recipe.settimeFlags === 0 &&
    recipe.ticks === "0" &&
    recipe.intervalSeconds === 0 &&
    recipe.intervalNanoseconds === 0
  );
}

function timerfdValueIsBounded(recipe: TimerfdRecipe): boolean {
  const inRange =
    recipe.valueSeconds >= 0 &&
    recipe.valueSeconds <= 10 &&
    recipe.valueNanoseconds >= 0 &&
    recipe.valueNanoseconds < 1_000_000_000;
  return inRange && (recipe.valueSeconds !== 0 || recipe.valueNanoseconds !== 0);
}

function activeTimerfdWait(resourcePlan: MoveResourcePlan): boolean {
  const capture = resourcePlan.capture;
  const active = `${capture?.wchan ?? ""} ${capture?.syscall ?? ""}`.toLowerCase();
  return /(timerfd|epoll|poll|select)/.test(active);
}

function timerfdRecipe(
  resource: GenericResource,
  timer: GenericPreflight["timers"][number] | undefined,
): TimerfdRecipe {
  return timer ? timerfdRecipeFromPreflight(timer) : timerfdRecipeFromResource(resource);
}

function timerfdRecipeFromPreflight(timer: GenericPreflight["timers"][number]): TimerfdRecipe {
  return { ...timer };
}

function timerfdRecipeFromResource(resource: GenericResource): TimerfdRecipe {
  return {
    fdinfoFlags: stringRecipeValue(resource, "fdinfoFlags"),
    clockId: numericRecipeValue(resource, "timerfdClockId") ?? "unknown",
    ticks: stringRecipeValue(resource, "timerfdTicks") ?? "unknown",
    settimeFlags: numericRecipeValue(resource, "timerfdSettimeFlags") ?? "unknown",
    valueSeconds: numericRecipeValue(resource, "timerfdValueSeconds") ?? 0,
    valueNanoseconds: numericRecipeValue(resource, "timerfdValueNanoseconds") ?? 0,
    intervalSeconds: numericRecipeValue(resource, "timerfdIntervalSeconds") ?? 0,
    intervalNanoseconds: numericRecipeValue(resource, "timerfdIntervalNanoseconds") ?? 0,
  };
}

function numericRecipeValue(resource: GenericResource, key: string): number | undefined {
  const value = resource.recipe?.[key];
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
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
