# Native/process-continuation audit

This audit is retained only as current refusal evidence for `machinen move`.

## Current product rule

`machinen move` is the only cross-ISA product entrypoint. Native process,
runtime, and kernel-resource state is accepted only when the move-owned PID graph
translator has a target-native reconstruction proof. Otherwise it is refused.

## Current useful evidence

The retained native work is useful because it names state classes that `move`
must either translate or refuse:

- register and thread state;
- stack and return-chain state;
- private and executable memory mappings, including Memory/executable materialization and native-target-module-bytes evidence;
- open files, sockets, timers, eventfds, pipes, epoll, futexes, and active syscalls;
- signal, TLS, SIMD/FPU, and multi-thread scheduler state.

These are evidence classes. They are not product support by themselves.

## Current forbidden claims

The audit does not claim support for:

- source-ISA emulation;
- raw VM replay as cross-ISA process movement;
- arbitrary process restore;
- raw heap, stack, or register reconstruction as product success;
- kernel socket identity preservation;
- JavaScript heap restore;
- PostgreSQL or Redis memory restore.

## Current validation source

Use the product claim registry for the current status:

```sh
machinen support --json
machinen support --status stable-product-refusal --json
machinen support --status proof-only-fixture --json
```
