# Native resource translation

Issue #449 translates or refuses Linux kernel resources for native process
restore.

## Command

```sh
pnpm native-resource-translate
```

The proof creates a regular-file reopen recipe and refuses a brokerless socket.
The file-resource final-jump proof then consumes a regular-file recipe and proves
that target-native code can read from the reopened fd after a translated native
return.

## Recipes

Currently supported recipes:

- argv/env/cwd/exe/auxv metadata is carried through;
- regular files are reopened with path, offset, and flags;
- explicitly modeled one-fd `ppoll` proofs may request synthetic empty pipe and
  empty eventfd recipes at the captured fd;
- raw sockets and PTYs can be represented only when the caller declares a host
  broker capability for that kind.

## Refusals

Unsupported resources are not silently dropped. They are returned with:

- `fd-kind-unsupported` for unknown generic fd entries;
- `kernel-state-unsupported` for pipes, sockets, epoll, eventfd, timerfd, and
  signalfd resources whose kernel state is not explicitly modeled by a narrow
  proof recipe;
- `resource-kind-unsupported` for resources that need a broker recipe, such as
  PTYs and raw sockets without an enabled broker capability.

Each refusal includes the resource id, kind, fd, and path when available.

## Boundary

This issue defines resource recipes. The follow-up file-resource final-jump
proof applies only regular-file recipes that can be reopened by path on the
target host. A host broker is still required before `ping` raw sockets, PTYs,
child process trees, timers, epoll sets, and futex waiters can resume
transparently.

See also: [Native non-file resource boundary](./native-nonfile-resource-boundary.md).
