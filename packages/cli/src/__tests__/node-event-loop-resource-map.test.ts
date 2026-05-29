import { describe, expect, it } from "vitest";

import {
  addNodeLevel4Refusal,
  addNodeLevel4MappedResource,
  addNodeTcpListenerResource,
  createNodeEventLoopLevel4ResourceMap,
  nodeEventLoopLevel4StableRefusalCodes,
} from "../clean-service/node-event-loop-resource-map.ts";

describe("Node event-loop Level 4 resource map", () => {
  it("maps libuv server sockets to the generic TCP listener profile", () => {
    const map = createNodeEventLoopLevel4ResourceMap();

    addNodeTcpListenerResource(map, {
      fd: 19,
      bindAddress: "127.0.0.1",
      port: 3000,
      backlog: "requires-node-verifier",
    });

    expect(map).toMatchObject({
      kind: "machinen.node-event-loop-level4-resource-map",
      sourceGoal: "008",
      evidenceStatus: "planning",
      productSupport: "not-yet-supported",
      implementationLevel: "not-implemented",
      graduationTargetLevel: "level-4-kernel-resource-reconstruction",
      summary: { mapped: 1, refused: 0 },
    });
    expect(map.genericResources[0]).toMatchObject({
      kind: "tcp-listener",
      libuvHandle: "uv_tcp_t/server",
      genericProfile: "tcp-listener-v1-loopback-empty-accept-queue",
      decision: "mapped-to-generic-level4-descriptor",
      details: {
        bindAddress: "127.0.0.1",
        port: 3000,
        backlog: "requires-node-verifier",
        acceptQueue: "empty",
      },
    });
  });

  it("records generic mappings for event-loop wakeups and pipes", () => {
    const map = createNodeEventLoopLevel4ResourceMap();

    addNodeLevel4MappedResource(map, {
      kind: "eventfd",
      libuvHandle: "uv_async_t/event-loop-wakeup",
      genericProfile: "eventfd-counter-v1-nonsemaphore-no-waiters",
      decision: "mapped-to-target-runtime-startup",
      details: { policy: "target runtime recreates the wakeup fd" },
    });
    addNodeLevel4MappedResource(map, {
      kind: "pipe",
      libuvHandle: "uv_pipe_t/runtime",
      genericProfile: "pipe-pair-v1-empty-no-waiters",
      decision: "mapped-to-target-runtime-startup",
      details: { policy: "target runtime recreates internal pipe handles" },
    });

    expect(map.summary).toEqual({ mapped: 2, refused: 0 });
    expect(map.genericResources.map((resource) => resource.genericProfile)).toEqual([
      "eventfd-counter-v1-nonsemaphore-no-waiters",
      "pipe-pair-v1-empty-no-waiters",
    ]);
  });

  it("keeps unsafe Node/libuv states as stable fail-closed refusals", () => {
    const map = createNodeEventLoopLevel4ResourceMap();

    const refusal = addNodeLevel4Refusal(map, {
      code: "node-child-process-tree-unsupported",
      message: "Node child process or IPC trees are not portable yet",
    });

    expect(nodeEventLoopLevel4StableRefusalCodes).toContain("node-child-process-tree-unsupported");
    expect(refusal).toMatchObject({
      migrationCompleted: false,
      productSupport: "unsupported",
      implementationLevel: "level-0-fail-closed-discovery",
    });
    expect(map.summary).toEqual({ mapped: 0, refused: 1 });
  });
});
