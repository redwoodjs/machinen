# Native non-file resource boundary

Issue #484 defines the fail-closed boundary for native resources that are not regular files.

## Flow

The verifier launches an ordinary arm64 Linux target that opens:

- one regular file;
- a pipe;
- a Unix socketpair;
- an epoll set watching the pipe;
- an eventfd;
- a timerfd.

The native procfs/ptrace capturer records all open fds through `/proc/<pid>/fd` and `/proc/<pid>/fdinfo`. Resource translation then proves two things can be true at the same time:

1. the regular file keeps a reopen recipe; and
2. unrelated non-file resources are refused with exact codes instead of hiding or downgrading the safe file recipe.

A passing run emits:

```text
captured-regular-file-coexists-with-precise-nonfile-resource-refusals
```

## Matrix

| Resource kind         | Current action                                                                      | Refusal code                             |
| --------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| argv/env/cwd/exe/auxv | carry metadata/recipe                                                               | n/a                                      |
| regular file          | reopen by path + offset                                                             | n/a                                      |
| pipe                  | refuse                                                                              | `kernel-state-unsupported`               |
| socket                | refuse                                                                              | `kernel-state-unsupported`               |
| epoll                 | recreate only the `interest-list-v1` known-fd subset; refuse active/ambiguous state | `target-epoll-syscall-state-unsupported` |
| eventfd               | refuse                                                                              | `kernel-state-unsupported`               |
| timerfd               | refuse as `timer`                                                                   | `kernel-state-unsupported`               |
| signalfd              | refuse as `signal`                                                                  | `kernel-state-unsupported`               |
| PTY                   | refuse unless a PTY broker capability is supplied                                   | `resource-kind-unsupported`              |
| raw socket            | refuse unless a raw-socket broker capability is supplied                            | `resource-kind-unsupported`              |
| unknown fd            | refuse                                                                              | `fd-kind-unsupported`                    |

The refusal detail records the missing model. Socket resources require
accept/connect/listen queues, peer identity, credentials, namespaces, options,
shutdown/readiness, and partial-transfer state. Epoll now has a narrow supported
subset for finite level-triggered interest lists whose watched fds already have
accepted target recipes; ready-list ordering, edge-triggered delivery state,
nested epoll, active waits, and wakeup ordering still refuse. signalfd resources
require pending signal queues, siginfo payload ownership, delivery ordering, and
signal-mask coordination.

## Next broker candidates

The first broker candidates are PTYs and raw sockets because the existing resource translator already has capability gates for those recipe shapes. Pipes, sockets, active epoll waits/ready lists, eventfd, timerfd, and signalfd carry kernel state that must be modeled or brokered before transparent restore can safely claim broader support.

## Verify

Run on Linux/arm64:

```sh
pnpm native-nonfile-resource-boundary
```

Other hosts skip honestly because this proof captures the arm64 source side through Linux procfs.

Next: [Native real utility continuation attempt](./native-real-utilities.md).
