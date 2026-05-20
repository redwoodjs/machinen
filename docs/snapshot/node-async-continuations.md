# Node async continuation metadata

Issue #435 models cooperative Node async state without copying V8 stacks or event-loop memory.

The initial adapter records **semantic continuation tokens**:

- continuation id
- kind: `promise` or `timer`
- handler token
- semantic payload root stored in the runtime adapter graph
- timer delay metadata

Restore looks up the handler token in the target adapter and invokes it with the restored payload. This proves the same strategy as the native continuation proof: move live values and continuation identity, not raw source stack bytes.

## Supported now

- Promise-style continuation payloads.
- Timer-style continuation payloads.
- Shared/cyclic object payloads through the Node semantic graph adapter.

## Refused now

Native callbacks such as fs watchers, unknown libuv handles, in-flight C++ callbacks, and opaque event-loop internals return `runtime-heap-unsupported` with the exact missing metadata.

This keeps real Node/pi/Claude-Code-style work honest: safe cooperative checkpoints can restore semantic async state; arbitrary event-loop internals still need runtime adapter support.
