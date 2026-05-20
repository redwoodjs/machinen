# Native resource translation

Issue #449 translates or refuses Linux kernel resources for native process
restore.

## Command

```sh
pnpm native-resource-translate
```

The proof creates a regular-file reopen recipe and refuses a brokerless socket.

## Recipes

Currently supported recipes:

- argv/env/cwd/exe/auxv metadata is carried through;
- regular files are reopened with path, offset, and flags;
- raw sockets and PTYs can be represented only when the caller declares a host
  broker capability for that kind.

## Refusals

Unsupported resources are not silently dropped. They are returned with:

- `fd-kind-unsupported` for unknown generic fd entries;
- `resource-kind-unsupported` for sockets, pipes, timers, epoll, futexes,
  namespaces, credentials, and other resources without a broker recipe.

Each refusal includes the resource id, kind, fd, and path when available.

## Boundary

This issue defines resource recipes. It does not implement the host broker
itself. That broker is required before `ping` raw sockets, PTYs, child process
trees, timers, epoll sets, and futex waiters can resume transparently.
