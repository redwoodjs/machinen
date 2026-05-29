# Node event-loop Level 4 resource map

Goal 008 starts mapping Node/libuv event-loop state onto the generic Level 4 resources. This is not product support for arbitrary Node process continuation. It is a planning/proof map that keeps unsafe states refused until each one has a generic descriptor and target-native verifier.

## Current mapped resources

Portable Node clean-service captures can now carry `eventLoopResources` with kind `machinen.node-event-loop-level4-resource-map`.

The first map records:

- `uv_tcp_t/server` -> `tcp-listener-v1-loopback-empty-accept-queue` planning descriptor;
- `uv_pipe_t/runtime` -> `pipe-pair-v1-empty-no-waiters` target-runtime startup mapping;
- `uv_async_t/event-loop-wakeup` -> `eventfd-counter-v1-nonsemaphore-no-waiters` target-runtime startup mapping.

The TCP listener entry records the generic profile, loopback address, port, empty accept queue, and a backlog policy. The backlog still needs a Node verifier/extractor before this can become Node product support.

## Stable refusals

The map keeps these unsafe event-loop states fail-closed:

- active TCP streams;
- child process or IPC trees;
- fs watchers;
- native addon ABI state;
- worker-thread/unsupported V8 or libuv state;
- inspector/debug sessions;
- timerfd deadlines;
- Unix sockets;
- mmapped durable/database-like state.

Each refusal keeps `migrationCompleted=false`, `productSupport=unsupported`, and `implementationLevel=level-0-fail-closed-discovery`.
