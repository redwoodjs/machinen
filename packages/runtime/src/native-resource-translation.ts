/** Kernel-resource recipes and refusals for native process restore. */

import type { NativeProcessImageRefusal, NativeProcessResource } from "./native-process-image.ts";

export interface NativeResourceTranslationRequest {
  resources: NativeProcessResource[];
  hostCapabilities?: string[];
}

export interface NativeResourceTranslationResult {
  resources: NativeProcessResource[];
  refusals: NativeProcessImageRefusal[];
}

export function translateNativeResources(
  request: NativeResourceTranslationRequest,
): NativeResourceTranslationResult {
  const capabilities = new Set(request.hostCapabilities ?? []);
  const resources = request.resources.map((resource) => translateResource(resource, capabilities));
  return {
    resources,
    refusals: resources.flatMap((resource) => (resource.refusal ? [resource.refusal] : [])),
  };
}

// fallow-ignore-next-line complexity
function translateResource(
  resource: NativeProcessResource,
  capabilities: Set<string>,
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
    refusal: resourceRefusal(resource),
  };
}

function resourceRefusal(resource: NativeProcessResource): NativeProcessImageRefusal {
  const code = resourceRefusalCode(resource);
  return {
    code,
    message: `resource ${resource.id} (${resource.kind}) needs a host broker recipe before native restore`,
    detail: {
      id: resource.id,
      kind: resource.kind,
      fd: resource.fd,
      path: resource.path,
      boundary: code === "kernel-state-unsupported" ? "kernel-state" : "broker-recipe",
    },
  };
}

function resourceRefusalCode(resource: NativeProcessResource): NativeProcessImageRefusal["code"] {
  if (resource.kind === "fd" || resource.kind === "unknown") {
    return "fd-kind-unsupported";
  }
  if (
    resource.kind === "pipe" ||
    resource.kind === "socket" ||
    resource.kind === "epoll" ||
    resource.kind === "timer" ||
    resource.kind === "eventfd" ||
    resource.kind === "signal"
  ) {
    return "kernel-state-unsupported";
  }
  return "resource-kind-unsupported";
}
