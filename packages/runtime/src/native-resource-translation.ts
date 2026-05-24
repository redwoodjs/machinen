/** Kernel-resource recipes and refusals for native process restore. */

import { nativeFdAccessMode, nativeFdCloseOnExec } from "./native-fd-flags.ts";
import type { NativeProcessImageRefusal, NativeProcessResource } from "./native-process-image.ts";
import type { TargetGuestRestoreResourceRecipe } from "./target-guest-restore-loader.ts";

export interface NativeInheritedStdioPolicy {
  mode: "inherit-output" | "require-explicit";
}

export interface NativeResourceTranslationRequest {
  resources: NativeProcessResource[];
  hostCapabilities?: string[];
  inheritedStdio?: NativeInheritedStdioPolicy;
  syntheticEmptyPipeFds?: number[];
  syntheticEmptyEventFds?: number[];
  syntheticTimerFds?: number[];
}

export interface NativeResourceTranslationResult {
  resources: NativeProcessResource[];
  refusals: NativeProcessImageRefusal[];
}

export type NativeTargetFdTableEntryKind =
  | "close-fd"
  | "inherit-stdio"
  | "reopen-file"
  | "synthetic-empty-pipe-read-end"
  | "synthetic-empty-pipe-write-end"
  | "synthetic-empty-eventfd"
  | "synthetic-timerfd"
  | "synthetic-signalfd"
  | "synthetic-epoll"
  | "refused";

export interface NativeTargetFdTableEntry {
  targetFd: number;
  capturedFd?: number;
  resourceId?: string;
  resourceKind?: NativeProcessResource["kind"];
  kind: NativeTargetFdTableEntryKind;
  closeOnExec: boolean;
  action: "materialize" | "close" | "refuse";
  source: "captured-resource" | "missing-captured-fd";
  recipe?: Record<string, unknown>;
  targetGuestRecipe?: TargetGuestRestoreResourceRecipe;
  refusal?: NativeProcessImageRefusal;
  provenance: {
    resourceId?: string;
    capturedFd?: number;
    targetFd: number;
    flags?: string[];
    reason: string;
  };
}

export interface NativeTargetFdTablePlanRequest extends NativeResourceTranslationRequest {
  expectedFds?: number[];
}

export interface NativeTargetFdTablePlan {
  entries: NativeTargetFdTableEntry[];
  resources: NativeProcessResource[];
  targetGuestResources: TargetGuestRestoreResourceRecipe[];
  refusals: NativeProcessImageRefusal[];
}

export function translateNativeResources(
  request: NativeResourceTranslationRequest,
): NativeResourceTranslationResult {
  const capabilities = new Set(request.hostCapabilities ?? []);
  const syntheticEmptyPipeFds = new Set(request.syntheticEmptyPipeFds ?? []);
  const syntheticEmptyEventFds = new Set(request.syntheticEmptyEventFds ?? []);
  const syntheticTimerFds = new Set(request.syntheticTimerFds ?? []);
  const syntheticPipePaths = syntheticEmptyPipePaths(request.resources, syntheticEmptyPipeFds);
  const resources = request.resources.map((resource) =>
    translateResource(
      resource,
      capabilities,
      request.inheritedStdio,
      syntheticEmptyPipeFds,
      syntheticEmptyEventFds,
      syntheticTimerFds,
      syntheticPipePaths,
    ),
  );
  return {
    resources,
    refusals: resources.flatMap((resource) => (resource.refusal ? [resource.refusal] : [])),
  };
}

export function planNativeTargetFdTable(
  request: NativeTargetFdTablePlanRequest,
): NativeTargetFdTablePlan {
  const translated = translateNativeResources(request);
  const duplicateRefusals = duplicateFdRefusals(request.resources);
  const duplicatedFds = new Set(duplicateRefusals.map((refusal) => refusal.detail?.fd as number));
  const fdResources = translated.resources
    .filter((resource) => resource.fd !== undefined)
    .filter((resource) => !duplicatedFds.has(resource.fd!));
  const plannedFds = new Set([
    ...fdResources.map((resource) => resource.fd!),
    ...(request.expectedFds ?? []),
  ]);
  const entries = Array.from(plannedFds)
    .sort((left, right) => left - right)
    .map((fd) =>
      fdTableEntry(
        fd,
        fdResources.find((resource) => resource.fd === fd),
        fdResources,
      ),
    );
  const refusals = [
    ...duplicateRefusals,
    ...entries.flatMap((entry) => (entry.refusal ? [entry.refusal] : [])),
  ];
  return {
    entries,
    resources: translated.resources,
    targetGuestResources: targetGuestResourcesFromFdTableEntries(entries),
    refusals,
  };
}

function syntheticEmptyPipePaths(
  resources: NativeProcessResource[],
  syntheticEmptyPipeFds: Set<number>,
): Map<string, number> {
  return new Map(
    resources
      .filter(
        (resource) =>
          resource.kind === "pipe" &&
          resource.fd !== undefined &&
          resource.path &&
          syntheticEmptyPipeFds.has(resource.fd),
      )
      .map((resource) => [resource.path!, resource.fd!]),
  );
}

function duplicateFdRefusals(resources: NativeProcessResource[]): NativeProcessImageRefusal[] {
  const byFd = new Map<number, NativeProcessResource[]>();
  for (const resource of resources) {
    if (resource.fd === undefined) {
      continue;
    }
    byFd.set(resource.fd, [...(byFd.get(resource.fd) ?? []), resource]);
  }
  return Array.from(byFd.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([fd, matches]) => ({
      code: "target-fd-table-duplicate",
      message: `fd table contains ${matches.length} captured resources for fd ${fd}`,
      detail: {
        fd,
        resourceIds: matches.map((resource) => resource.id),
        boundary: "target-fd-table",
      },
    }));
}

function fdTableEntry(
  fd: number,
  resource: NativeProcessResource | undefined,
  resources: NativeProcessResource[],
): NativeTargetFdTableEntry {
  if (!resource) {
    return closeFdTableEntry(fd, "missing-captured-fd");
  }
  if (resource.refusal || resource.state === "refused" || resource.state === "unsupported") {
    const refusal = resource.refusal ?? fdTableMissingRefusal(fd, resource);
    return refusedFdTableEntry(resource, refusal);
  }
  const entry = fdTableEntryFromRecipe(fd, resource, resource.recipe ?? {}, resources);
  return entry ?? refusedFdTableEntry(resource, fdTableMissingRefusal(fd, resource));
}

function fdTableEntryFromRecipe(
  fd: number,
  resource: NativeProcessResource,
  recipe: Record<string, unknown>,
  resources: NativeProcessResource[],
): NativeTargetFdTableEntry | undefined {
  const closeOnExec = nativeFdCloseOnExec(resource.flags);
  return (
    inheritedStdioFdTableEntry(fd, resource, recipe, closeOnExec) ??
    reopenFileFdTableEntry(fd, resource, recipe, closeOnExec) ??
    syntheticFdTableEntry(fd, resource, recipe, closeOnExec) ??
    syntheticSignalfdFdTableEntry(resource, recipe, closeOnExec) ??
    syntheticEpollFdTableEntry(resource, recipe, closeOnExec, resources)
  );
}

function inheritedStdioFdTableEntry(
  fd: number,
  resource: NativeProcessResource,
  recipe: Record<string, unknown>,
  closeOnExec: boolean,
): NativeTargetFdTableEntry | undefined {
  return recipe.inherit === "stdout" || recipe.inherit === "stderr"
    ? materializedFdTableEntry(resource, "inherit-stdio", closeOnExec, {
        kind: "inherit-stdio",
        fd: targetStdioFd(fd, recipe.inherit),
        stream: recipe.inherit,
        closeOnExec,
      })
    : undefined;
}

function reopenFileFdTableEntry(
  fd: number,
  resource: NativeProcessResource,
  recipe: Record<string, unknown>,
  closeOnExec: boolean,
): NativeTargetFdTableEntry | undefined {
  return typeof recipe.reopen === "string"
    ? materializedFdTableEntry(resource, "reopen-file", closeOnExec, {
        kind: "reopen-file",
        fd,
        path: recipe.reopen,
        offset: typeof recipe.offset === "number" ? recipe.offset : 0,
        access: targetFdAccess(resource.flags),
        closeOnExec,
      })
    : undefined;
}

function syntheticFdTableEntry(
  fd: number,
  resource: NativeProcessResource,
  recipe: Record<string, unknown>,
  closeOnExec: boolean,
): NativeTargetFdTableEntry | undefined {
  const recipes: Record<string, NativeTargetFdTableEntry | undefined> = {
    "empty-pipe-read-end": materializedFdTableEntry(
      resource,
      "synthetic-empty-pipe-read-end",
      closeOnExec,
      { kind: "synthetic-empty-pipe", readFd: fd, closeOnExec },
    ),
    "empty-pipe-write-end": materializedFdTableEntry(
      resource,
      "synthetic-empty-pipe-write-end",
      closeOnExec,
    ),
    "empty-eventfd": materializedFdTableEntry(resource, "synthetic-empty-eventfd", closeOnExec, {
      kind: "synthetic-empty-eventfd",
      fd,
      closeOnExec,
    }),
    timerfd: materializedFdTableEntry(resource, "synthetic-timerfd", closeOnExec, {
      kind: "synthetic-timerfd",
      fd,
      closeOnExec,
    }),
  };
  return typeof recipe.synthetic === "string" ? recipes[recipe.synthetic] : undefined;
}

function syntheticSignalfdFdTableEntry(
  resource: NativeProcessResource,
  recipe: Record<string, unknown>,
  closeOnExec: boolean,
): NativeTargetFdTableEntry | undefined {
  if (resource.kind !== "signalfd" || recipe.signalfdModel !== "empty-queue-v1") {
    return undefined;
  }
  const signalfdRecipe = normalizedSignalfdRecipe(resource, recipe);
  if ("code" in signalfdRecipe) {
    return refusedFdTableEntry(resource, signalfdRecipe);
  }
  return materializedFdTableEntry(resource, "synthetic-signalfd", closeOnExec, {
    kind: "synthetic-signalfd",
    fd: resource.fd!,
    signalMask: signalfdRecipe.signalMask,
    flags: signalfdRecipe.flags,
    closeOnExec,
  });
}

// fallow-ignore-next-line complexity
function normalizedSignalfdRecipe(
  resource: NativeProcessResource,
  recipe: Record<string, unknown>,
): { signalMask: string; flags: number } | NativeProcessImageRefusal {
  const signalMask =
    typeof recipe.signalMask === "string" ? normalizeHex(recipe.signalMask) : undefined;
  const rawFlags = recipe.flags;
  const flags =
    typeof rawFlags === "number" && Number.isSafeInteger(rawFlags) && rawFlags >= 0
      ? rawFlags
      : undefined;
  if (!signalMask || flags === undefined) {
    return signalfdRefusal(resource, "signalfd recipe requires a finite mask and flags");
  }
  if ((flags & ~SIGNALFD_SUPPORTED_FLAGS) !== 0) {
    return signalfdRefusal(resource, "signalfd flags are unsupported", { flags });
  }
  if (recipe.pendingSignals !== "none" || recipe.queuedSiginfo !== "empty") {
    return signalfdRefusal(resource, "pending signals and queued siginfo must be empty", {
      pendingSignals: recipe.pendingSignals,
      queuedSiginfo: recipe.queuedSiginfo,
    });
  }
  if (recipe.activeSignalFrame !== false) {
    return signalfdRefusal(resource, "active signal frames remain unsupported", {
      activeSignalFrame: recipe.activeSignalFrame,
    });
  }
  if (recipe.altStackState !== "disabled" && recipe.altStackState !== "not-required") {
    return signalfdRefusal(resource, "active signal alt-stack state remains unsupported", {
      altStackState: recipe.altStackState,
    });
  }
  return { signalMask, flags };
}

function syntheticEpollFdTableEntry(
  resource: NativeProcessResource,
  recipe: Record<string, unknown>,
  closeOnExec: boolean,
  resources: NativeProcessResource[],
): NativeTargetFdTableEntry | undefined {
  if (resource.kind !== "epoll" || recipe.epollModel !== "interest-list-v1") {
    return undefined;
  }
  const watches = epollWatchRecipes(resource, recipe, resources);
  if (Array.isArray(watches)) {
    return materializedFdTableEntry(resource, "synthetic-epoll", closeOnExec, {
      kind: "synthetic-epoll",
      fd: resource.fd!,
      watches,
      closeOnExec,
    });
  }
  return refusedFdTableEntry(resource, watches);
}

function epollWatchRecipes(
  resource: NativeProcessResource,
  recipe: Record<string, unknown>,
  resources: NativeProcessResource[],
): Array<{ fd: number; events: number; data: string }> | NativeProcessImageRefusal {
  const watches = Array.isArray(recipe.watches) ? recipe.watches : undefined;
  if (!watches || watches.length === 0) {
    return epollRefusal(resource, "epoll recipe requires a finite non-empty interest list");
  }
  const planned: Array<{ fd: number; events: number; data: string }> = [];
  for (const [index, watch] of watches.entries()) {
    const plannedWatch = epollWatchRecipe(resource, watch, index, resources);
    if ("code" in plannedWatch) {
      return plannedWatch;
    }
    planned.push(plannedWatch);
  }
  return planned;
}

// fallow-ignore-next-line complexity
function epollWatchRecipe(
  resource: NativeProcessResource,
  value: unknown,
  index: number,
  resources: NativeProcessResource[],
): { fd: number; events: number; data: string } | NativeProcessImageRefusal {
  if (!isRecord(value)) {
    return epollRefusal(resource, `epoll watch ${index} is malformed`);
  }
  const fd = typeof value.fd === "number" ? value.fd : undefined;
  const events = typeof value.events === "number" ? value.events : undefined;
  const data = typeof value.data === "string" ? value.data : undefined;
  const watched = fd === undefined ? undefined : resources.find((candidate) => candidate.fd === fd);
  if (fd === undefined || events === undefined || data === undefined || !isHex(data)) {
    return epollRefusal(resource, `epoll watch ${index} is missing fd/events/data`);
  }
  if (fd === resource.fd || watched?.kind === "epoll") {
    return epollRefusal(resource, "nested epoll and self-watch state remain unsupported");
  }
  const unmodeledEvents = epollUnmodeledEvents(events);
  if (unmodeledEvents !== 0) {
    return epollRefusal(
      resource,
      "epoll edge-triggered or one-shot delivery state is unsupported",
      {
        events,
        unmodeledEvents,
      },
    );
  }
  if (!watched || watched.state !== "recipe" || watched.refusal) {
    return epollRefusal(resource, "epoll watched fd has no accepted target recipe", {
      watchedFd: fd,
      watchedKind: watched?.kind,
      watchedState: watched?.state,
      watchedRefusalCode: watched?.refusal?.code,
    });
  }
  return { fd, events, data };
}

function materializedFdTableEntry(
  resource: NativeProcessResource,
  kind: NativeTargetFdTableEntryKind,
  closeOnExec: boolean,
  targetGuestRecipe?: TargetGuestRestoreResourceRecipe,
): NativeTargetFdTableEntry {
  return {
    targetFd: resource.fd!,
    capturedFd: resource.fd,
    resourceId: resource.id,
    resourceKind: resource.kind,
    kind,
    closeOnExec,
    action: "materialize",
    source: "captured-resource",
    recipe: resource.recipe,
    targetGuestRecipe,
    provenance: {
      resourceId: resource.id,
      capturedFd: resource.fd,
      targetFd: resource.fd!,
      flags: resource.flags,
      reason: "translated-resource-recipe",
    },
  };
}

function closeFdTableEntry(fd: number, reason: string): NativeTargetFdTableEntry {
  return {
    targetFd: fd,
    kind: "close-fd",
    closeOnExec: false,
    action: "close",
    source: "missing-captured-fd",
    targetGuestRecipe: { kind: "close-fd", fd, reason },
    provenance: { targetFd: fd, reason },
  };
}

function refusedFdTableEntry(
  resource: NativeProcessResource,
  refusal: NativeProcessImageRefusal,
): NativeTargetFdTableEntry {
  return {
    targetFd: resource.fd!,
    capturedFd: resource.fd,
    resourceId: resource.id,
    resourceKind: resource.kind,
    kind: "refused",
    closeOnExec: nativeFdCloseOnExec(resource.flags),
    action: "refuse",
    source: "captured-resource",
    refusal,
    provenance: {
      resourceId: resource.id,
      capturedFd: resource.fd,
      targetFd: resource.fd!,
      flags: resource.flags,
      reason: "resource-refused-before-target-execution",
    },
  };
}

function fdTableMissingRefusal(
  fd: number,
  resource: NativeProcessResource,
): NativeProcessImageRefusal {
  return {
    code: "target-fd-table-missing",
    message: `fd ${fd} has no target loader recipe`,
    detail: {
      fd,
      resourceId: resource.id,
      kind: resource.kind,
      boundary: "target-fd-table",
    },
  };
}

function targetStdioFd(fd: number, stream: "stdout" | "stderr"): 1 | 2 {
  if (fd === 1 && stream === "stdout") {
    return 1;
  }
  return 2;
}

function targetFdAccess(flags: string[] | undefined): 0 | 1 | 2 {
  const access = nativeFdAccessMode(flags);
  return access === 1 || access === 2 ? access : 0;
}

function targetGuestResourcesFromFdTableEntries(
  entries: NativeTargetFdTableEntry[],
): TargetGuestRestoreResourceRecipe[] {
  const writeFdsByReadFd = new Map<number, number>();
  for (const entry of entries) {
    if (entry.kind === "synthetic-empty-pipe-write-end") {
      const pairedReadFd = entry.recipe?.pairedReadFd;
      if (typeof pairedReadFd === "number") {
        writeFdsByReadFd.set(pairedReadFd, entry.targetFd);
      }
    }
  }
  return entries
    .filter((entry) => entry.action !== "refuse" && entry.targetGuestRecipe)
    .map((entry) => {
      const recipe = entry.targetGuestRecipe!;
      return recipe.kind === "synthetic-empty-pipe"
        ? { ...recipe, writeFd: writeFdsByReadFd.get(recipe.readFd) }
        : recipe;
    });
}

// fallow-ignore-next-line complexity
function translateResource(
  resource: NativeProcessResource,
  capabilities: Set<string>,
  inheritedStdio: NativeInheritedStdioPolicy | undefined,
  syntheticEmptyPipeFds: Set<number>,
  syntheticEmptyEventFds: Set<number>,
  syntheticTimerFds: Set<number>,
  syntheticPipePaths: Map<string, number>,
): NativeProcessResource {
  if (
    resource.kind === "argv" ||
    resource.kind === "env" ||
    resource.kind === "cwd" ||
    resource.kind === "exe" ||
    resource.kind === "auxv"
  ) {
    return { ...resource, state: resource.state === "refused" ? "captured" : resource.state };
  }
  const stdio = translateInheritedStdio(resource, inheritedStdio);
  if (stdio) {
    return stdio;
  }
  if (
    resource.kind === "eventfd" &&
    resource.fd !== undefined &&
    syntheticEmptyEventFds.has(resource.fd)
  ) {
    return {
      ...resource,
      state: "recipe",
      recipe: { ...resource.recipe, synthetic: "empty-eventfd", fd: resource.fd },
      refusal: undefined,
    };
  }
  if (
    resource.kind === "timer" &&
    resource.fd !== undefined &&
    syntheticTimerFds.has(resource.fd)
  ) {
    return {
      ...resource,
      state: "recipe",
      recipe: { ...resource.recipe, synthetic: "timerfd", fd: resource.fd },
      refusal: undefined,
    };
  }
  if (resource.kind === "pipe" && resource.fd !== undefined) {
    if (syntheticEmptyPipeFds.has(resource.fd)) {
      return {
        ...resource,
        state: "recipe",
        recipe: { synthetic: "empty-pipe-read-end", fd: resource.fd, pipeId: resource.path },
        refusal: undefined,
      };
    }
    const pairedReadFd = resource.path ? syntheticPipePaths.get(resource.path) : undefined;
    if (pairedReadFd !== undefined && nativeFdAccessMode(resource.flags) === 1) {
      return {
        ...resource,
        state: "recipe",
        recipe: {
          synthetic: "empty-pipe-write-end",
          fd: resource.fd,
          pairedReadFd,
          pipeId: resource.path,
        },
        refusal: undefined,
      };
    }
  }
  if (resource.kind === "file" && resource.path) {
    return {
      ...resource,
      state: "recipe",
      recipe: {
        reopen: resource.path,
        offset: resource.offset ?? 0,
        flags: resource.flags ?? [],
      },
      refusal: undefined,
    };
  }
  if (resource.kind === "epoll" && resource.recipe?.epollModel === "interest-list-v1") {
    return {
      ...resource,
      state: "recipe",
      refusal: undefined,
    };
  }
  if (resource.kind === "signalfd" && resource.recipe?.signalfdModel === "empty-queue-v1") {
    return {
      ...resource,
      state: "recipe",
      refusal: undefined,
    };
  }
  if (resource.kind === "raw-socket" && capabilities.has("raw-socket")) {
    return {
      ...resource,
      state: "recipe",
      recipe: { broker: "raw-socket", fd: resource.fd, path: resource.path },
      refusal: undefined,
    };
  }
  if (resource.kind === "pty" && capabilities.has("pty")) {
    return {
      ...resource,
      state: "recipe",
      recipe: { broker: "pty", fd: resource.fd, path: resource.path },
      refusal: undefined,
    };
  }
  return {
    ...resource,
    state: "refused",
    refusal: resourceRefusal(resource, inheritedStdio),
  };
}

function translateInheritedStdio(
  resource: NativeProcessResource,
  inheritedStdio: NativeInheritedStdioPolicy | undefined,
): NativeProcessResource | undefined {
  if (!inheritedStdio || !isStdioFd(resource)) {
    return undefined;
  }
  if (resource.fd === 0) {
    return {
      ...resource,
      state: "refused",
      refusal: resourceRefusalWithCode(resource, "stdin-buffer-state-unsupported"),
    };
  }
  if (inheritedStdio.mode === "require-explicit") {
    return {
      ...resource,
      state: "refused",
      refusal: resourceRefusalWithCode(resource, "inherited-stdio-policy-required"),
    };
  }
  return {
    ...resource,
    state: "recipe",
    recipe: { inherit: resource.fd === 1 ? "stdout" : "stderr", fd: resource.fd },
    refusal: undefined,
  };
}

function isStdioFd(resource: NativeProcessResource): boolean {
  return (
    (resource.fd === 0 && resource.kind !== "file") ||
    (resource.fd === 1 && resource.kind !== "file") ||
    (resource.fd === 2 && resource.kind !== "file")
  );
}

function resourceRefusal(
  resource: NativeProcessResource,
  inheritedStdio: NativeInheritedStdioPolicy | undefined,
): NativeProcessImageRefusal {
  return resourceRefusalWithCode(resource, resourceRefusalCode(resource, inheritedStdio));
}

function resourceRefusalWithCode(
  resource: NativeProcessResource,
  code: NativeProcessImageRefusal["code"],
): NativeProcessImageRefusal {
  return {
    code,
    message: `resource ${resource.id} (${resource.kind}) needs a host broker recipe before native restore`,
    detail: {
      id: resource.id,
      kind: resource.kind,
      fd: resource.fd,
      path: resource.path,
      boundary: resourceBoundary(code),
      requiredModel: resourceRequiredModel(resource),
    },
  };
}

function resourceRefusalCode(
  resource: NativeProcessResource,
  inheritedStdio: NativeInheritedStdioPolicy | undefined,
): NativeProcessImageRefusal["code"] {
  if (resource.kind === "fd" || resource.kind === "unknown") {
    return "fd-kind-unsupported";
  }
  if (isStatefulKernelResource(resource)) {
    return inheritedStdio ? "non-stdio-kernel-state-unsupported" : "kernel-state-unsupported";
  }
  return "resource-kind-unsupported";
}

const SIGNALFD_SUPPORTED_FLAGS = 0x800;
const EPOLL_EDGE_TRIGGERED = 0x80000000;
const EPOLL_ONESHOT = 0x40000000;

function epollUnmodeledEvents(events: number): number {
  return [EPOLL_EDGE_TRIGGERED, EPOLL_ONESHOT].reduce(
    (mask, flag) => (Math.floor(events / flag) % 2 === 1 ? mask + flag : mask),
    0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHex(value: string): boolean {
  return /^0x[0-9a-f]+$/i.test(value);
}

function normalizeHex(value: string): string | undefined {
  if (!isHex(value)) {
    return undefined;
  }
  return `0x${BigInt(value).toString(16)}`;
}

function signalfdRefusal(
  resource: NativeProcessResource,
  reason: string,
  detail: Record<string, unknown> = {},
): NativeProcessImageRefusal {
  return {
    code: "target-signalfd-state-unsupported",
    message: `signalfd resource ${resource.id} cannot be recreated target-natively`,
    detail: {
      id: resource.id,
      kind: resource.kind,
      fd: resource.fd,
      path: resource.path,
      boundary: "signalfd-empty-queue",
      reason,
      requiredModel: RESOURCE_REQUIRED_MODELS.signalfd,
      ...detail,
    },
  };
}

function epollRefusal(
  resource: NativeProcessResource,
  reason: string,
  detail: Record<string, unknown> = {},
): NativeProcessImageRefusal {
  return {
    code: "target-epoll-syscall-state-unsupported",
    message: `epoll resource ${resource.id} cannot be recreated target-natively`,
    detail: {
      id: resource.id,
      kind: resource.kind,
      fd: resource.fd,
      path: resource.path,
      boundary: "epoll-interest-list",
      reason,
      requiredModel: RESOURCE_REQUIRED_MODELS.epoll,
      ...detail,
    },
  };
}

const RESOURCE_REQUIRED_MODELS: Partial<Record<NativeProcessResource["kind"], string[]>> = {
  socket: [
    "accept/connect/listen queue state",
    "peer endpoint identity",
    "credentials and namespaces",
    "socket options, shutdown state, readiness, and partial transfer state",
  ],
  epoll: [
    "interest list",
    "ready-list ordering",
    "edge-triggered delivery state",
    "nested epoll and wakeup ordering",
  ],
  signalfd: [
    "pending signal queue",
    "siginfo payload provenance",
    "delivery ordering",
    "signal-mask coordination",
  ],
  signal: [
    "pending signal queue",
    "siginfo payload provenance",
    "delivery ordering",
    "signal-mask coordination",
  ],
  eventfd: ["counter state", "semaphore mode", "readiness and wakeup ordering"],
  timer: ["timerfd clock", "absolute/relative expiry", "interval and overrun state"],
  pipe: ["pipe buffer contents", "peer fd ownership", "readiness and wakeup ordering"],
  "raw-socket": ["explicit broker capability", "network namespace and credential policy"],
  pty: ["explicit broker capability", "termios state", "session and foreground process group"],
};

function resourceRequiredModel(resource: NativeProcessResource): string[] {
  return RESOURCE_REQUIRED_MODELS[resource.kind] ?? [];
}

function isStatefulKernelResource(resource: NativeProcessResource): boolean {
  return (
    resource.kind === "pipe" ||
    resource.kind === "socket" ||
    resource.kind === "epoll" ||
    resource.kind === "timer" ||
    resource.kind === "eventfd" ||
    resource.kind === "signal" ||
    resource.kind === "signalfd"
  );
}

function resourceBoundary(code: NativeProcessImageRefusal["code"]): string {
  if (code === "kernel-state-unsupported" || code === "non-stdio-kernel-state-unsupported") {
    return "kernel-state";
  }
  if (code === "inherited-stdio-policy-required" || code === "stdin-buffer-state-unsupported") {
    return "stdio-policy";
  }
  return "broker-recipe";
}
