const NODE_EVENT_LOOP_LEVEL4_RESOURCE_MAP_VERSION = 1 as const;

export const nodeEventLoopLevel4StableRefusalCodes = [
  "node-active-tcp-session-unsupported",
  "node-child-process-tree-unsupported",
  "node-fs-watcher-unsupported",
  "node-native-addon-abi-state-unsupported",
  "node-worker-thread-unsupported",
  "node-inspector-session-unsupported",
  "node-unsupported-v8-libuv-state",
  "node-mmapped-durable-state-unsupported",
  "node-timerfd-state-unsupported",
  "node-unix-socket-unsupported",
] as const;

interface NodeEventLoopLevel4MappedResource {
  kind: "tcp-listener" | "pipe" | "eventfd" | "timerfd" | "unsupported";
  libuvHandle: string;
  genericProfile: string;
  decision: "mapped-to-generic-level4-descriptor" | "mapped-to-target-runtime-startup" | "refused";
  details: Record<string, unknown>;
}

interface NodeEventLoopLevel4ResourceRefusal {
  code: string;
  message: string;
  migrationCompleted: false;
  productSupport: "unsupported";
  implementationLevel: "level-0-fail-closed-discovery";
  genericProfile?: string;
}

export interface NodeEventLoopLevel4ResourceMap {
  kind: "machinen.node-event-loop-level4-resource-map";
  formatVersion: typeof NODE_EVENT_LOOP_LEVEL4_RESOURCE_MAP_VERSION;
  sourceGoal: "008";
  evidenceStatus: "planning";
  productSupport: "not-yet-supported";
  implementationLevel: "not-implemented";
  graduationTargetLevel: "level-4-kernel-resource-reconstruction";
  genericResources: NodeEventLoopLevel4MappedResource[];
  refusals: NodeEventLoopLevel4ResourceRefusal[];
  summary: { mapped: number; refused: number };
}

export function createNodeEventLoopLevel4ResourceMap(): NodeEventLoopLevel4ResourceMap {
  return {
    kind: "machinen.node-event-loop-level4-resource-map",
    formatVersion: NODE_EVENT_LOOP_LEVEL4_RESOURCE_MAP_VERSION,
    sourceGoal: "008",
    evidenceStatus: "planning",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-4-kernel-resource-reconstruction",
    genericResources: [],
    refusals: [],
    summary: { mapped: 0, refused: 0 },
  };
}

export function addNodeTcpListenerResource(
  map: NodeEventLoopLevel4ResourceMap,
  input: {
    fd?: number;
    bindAddress: string;
    port: number;
    backlog?: number | "requires-node-verifier";
  },
): void {
  addNodeLevel4MappedResource(map, {
    kind: "tcp-listener",
    libuvHandle: "uv_tcp_t/server",
    genericProfile: "tcp-listener-v1-loopback-empty-accept-queue",
    decision: "mapped-to-generic-level4-descriptor",
    details: {
      family: "inet",
      protocol: "tcp",
      bindAddress: input.bindAddress,
      port: input.port,
      backlog: input.backlog ?? "requires-node-verifier",
      acceptQueue: "empty",
      activeConnections: false,
      descriptorSource: "goals/007.md generic TCP listener descriptor",
    },
  });
}

export function addNodeLevel4MappedResource(
  map: NodeEventLoopLevel4ResourceMap,
  resource: NodeEventLoopLevel4MappedResource,
): void {
  map.genericResources.push(resource);
  if (resource.decision === "refused") {
    map.summary.refused += 1;
  } else {
    map.summary.mapped += 1;
  }
}

export function addNodeLevel4Refusal(
  map: NodeEventLoopLevel4ResourceMap,
  input: { code: string; message: string; genericProfile?: string },
): NodeEventLoopLevel4ResourceRefusal {
  const refusal: NodeEventLoopLevel4ResourceRefusal = {
    code: input.code,
    message: input.message,
    migrationCompleted: false,
    productSupport: "unsupported",
    implementationLevel: "level-0-fail-closed-discovery",
    ...(input.genericProfile ? { genericProfile: input.genericProfile } : {}),
  };
  map.refusals.push(refusal);
  map.summary.refused += 1;
  return refusal;
}
