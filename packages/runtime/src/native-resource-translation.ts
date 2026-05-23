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
): NativeTargetFdTableEntry {
  if (!resource) {
    return closeFdTableEntry(fd, "missing-captured-fd");
  }
  if (resource.refusal || resource.state === "refused" || resource.state === "unsupported") {
    const refusal = resource.refusal ?? fdTableMissingRefusal(fd, resource);
    return refusedFdTableEntry(resource, refusal);
  }
  const entry = fdTableEntryFromRecipe(fd, resource, resource.recipe ?? {});
  return entry ?? refusedFdTableEntry(resource, fdTableMissingRefusal(fd, resource));
}

function fdTableEntryFromRecipe(
  fd: number,
  resource: NativeProcessResource,
  recipe: Record<string, unknown>,
): NativeTargetFdTableEntry | undefined {
  const closeOnExec = nativeFdCloseOnExec(resource.flags);
  return (
    inheritedStdioFdTableEntry(fd, resource, recipe, closeOnExec) ??
    reopenFileFdTableEntry(fd, resource, recipe, closeOnExec) ??
    syntheticFdTableEntry(fd, resource, recipe, closeOnExec)
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
