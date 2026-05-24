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

Currently supported resource recipes:

- argv/env/cwd/exe/auxv metadata is carried through;
- regular files are reopened with path, offset, flags, and close-on-exec
  provenance;
- explicitly modeled one-fd `ppoll` proofs may request synthetic empty pipe,
  empty eventfd, and disarmed/future one-shot timerfd recipes at the captured fd;
- inherited stdout/stderr can be passed through only under an explicit inherited
  stdio policy; stdin remains refused because buffered input state is not
  modeled;
- raw sockets and PTYs can be represented only when the caller declares a host
  broker capability for that kind.

Issue #592 adds `planNativeTargetFdTable()`, which turns translated resources
into a deterministic target fd-table plan. The plan preserves the stable captured
fd -> target fd mapping, emits explicit `close-fd` recipes for expected fd slots
missing from the capture, carries close-on-exec provenance, and converts modeled
resources into target-guest loader recipes (`reopen-file`, `inherit-stdio`,
`synthetic-empty-pipe`, `synthetic-empty-eventfd`, and `synthetic-timerfd`).
The loader/trampoline handoff applies close-on-exec after restore setup and
before the target-native jump. Duplicate captured fds are refused before target
execution with `target-fd-table-duplicate`; captured fds without any safe target
recipe refuse with `target-fd-table-missing` or the underlying resource refusal.

## Resource boundary matrix

| Resource / fd state          | Current policy                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| regular file                 | reopen by path/offset/flags when provenance is safe                                          |
| stdio                        | inherit stdout/stderr only with explicit stdio policy; stdin refused                         |
| close-fd gap                 | explicit target `close-fd` recipe                                                            |
| synthetic empty pipe         | only for modeled ppoll/read proof slices with paired read/write ends                         |
| synthetic empty eventfd      | only counter-0, non-semaphore, modeled proof slices                                          |
| synthetic timerfd            | only modeled disarmed/future one-shot timerfd proof slices                                   |
| PTY                          | refuse unless a PTY broker capability is declared                                            |
| raw socket                   | refuse unless a raw-socket broker capability is declared                                     |
| sockets                      | refuse until queues, peer identity, shutdown/options, and namespace state are modeled        |
| epoll                        | refuse until interest lists, ready-list ordering, wakeups, and target fd mapping are modeled |
| signalfd                     | refuse until pending signal queue, siginfo payloads, and mask coordination are modeled       |
| generic eventfd/timerfd      | refuse except for the narrow empty/disarmed modeled states above                             |
| duplicate captured fd        | refuse with `target-fd-table-duplicate` before target execution                              |
| unsupported descriptor shape | refuse before loader/trampoline args are built                                               |

## Refusals

Unsupported resources are not silently dropped. They are returned with:

- `fd-kind-unsupported` for unknown generic fd entries;
- `kernel-state-unsupported` for pipes, sockets, epoll, eventfd, timerfd, and
  signalfd resources whose kernel state is not explicitly modeled by a narrow
  proof recipe;
- `resource-kind-unsupported` for resources that need a broker recipe, such as
  PTYs and raw sockets without an enabled broker capability;
- `target-fd-table-duplicate` when multiple captured resources claim the same
  fd;
- `target-fd-table-missing` when a captured fd has no loader recipe after
  translation.

Each refusal includes the resource id, kind, fd, and path when available.

## Boundary

This issue defines resource recipes. The follow-up file-resource final-jump
proof applies only regular-file recipes that can be reopened by path on the
target host. A host broker is still required before `ping` raw sockets, PTYs,
child process trees, timers, epoll sets, and futex waiters can resume
transparently.

See also: [Native non-file resource boundary](./native-nonfile-resource-boundary.md).
