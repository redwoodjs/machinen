/** Kernel-resource recipes and refusals for native process restore. */

import { nativeFdAccessMode } from "./native-fd-flags.ts";
import type { NativeProcessImageRefusal, NativeProcessResource } from "./native-process-image.ts";

export interface NativeInheritedStdioPolicy {
  mode: "inherit-output" | "require-explicit";
}

export interface NativeResourceTranslationRequest {
  resources: NativeProcessResource[];
  hostCapabilities?: string[];
  inheritedStdio?: NativeInheritedStdioPolicy;
  syntheticEmptyPipeFds?: number[];
  syntheticEmptyEventFds?: number[];
}

export interface NativeResourceTranslationResult {
  resources: NativeProcessResource[];
  refusals: NativeProcessImageRefusal[];
}

export function translateNativeResources(
  request: NativeResourceTranslationRequest,
): NativeResourceTranslationResult {
  const capabilities = new Set(request.hostCapabilities ?? []);
  const syntheticEmptyPipeFds = new Set(request.syntheticEmptyPipeFds ?? []);
  const syntheticEmptyEventFds = new Set(request.syntheticEmptyEventFds ?? []);
  const syntheticPipePaths = syntheticEmptyPipePaths(request.resources, syntheticEmptyPipeFds);
  const resources = request.resources.map((resource) =>
    translateResource(
      resource,
      capabilities,
      request.inheritedStdio,
      syntheticEmptyPipeFds,
      syntheticEmptyEventFds,
      syntheticPipePaths,
    ),
  );
  return {
    resources,
    refusals: resources.flatMap((resource) => (resource.refusal ? [resource.refusal] : [])),
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

// fallow-ignore-next-line complexity
function translateResource(
  resource: NativeProcessResource,
  capabilities: Set<string>,
  inheritedStdio: NativeInheritedStdioPolicy | undefined,
  syntheticEmptyPipeFds: Set<number>,
  syntheticEmptyEventFds: Set<number>,
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
    resource.kind === "signal"
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
