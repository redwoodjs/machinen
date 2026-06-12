# Generic resource graph move envelope

This document defines the next `machinen move` direction: support any binary whose observed resource graph is fully understood.

It does **not** claim arbitrary process teleportation. A generic resource graph move is target-native reconstruction from explicit, proven resource classes. If any observed resource is unsupported, unknown, or unsafe, `machinen move` must fail closed before target launch or return a refused loader with no target pid.

## Product slogan

> Support any binary whose resource graph is fully understood.

The product meaning is precise:

- `machinen move` may accept an unknown binary only when every observed process resource is classified as supported or explicitly ignorable by a proven resource-class rule.
- `machinen move` must refuse when any resource is unsupported, unknown, stale, changed, or only app-specific without a generic model.
- Target success requires visible target evidence, not metadata-only acceptance.

## Non-goals

The generic envelope is not:

- arbitrary VM, process, ELF, runtime, heap, or database restore;
- source-ISA emulation success;
- live memory/register teleportation across architectures;
- blind `execve` replay without resource validation;
- a way to hide unsupported pipes, PTYs, sockets, mmap, epoll, locks, timers, or native runtime state behind an accepted descriptor;
- a replacement for app-specific envelopes before their resource classes have been proven generic.

## Resource graph definition

A resource graph is the normalized state observed from a selected guest pid and its relevant process graph. The first generic descriptor target is:

```ts
genericProcessState = {
  executableIdentity,
  argv,
  env,
  cwd,
  uidGid,
  ports,
  regularFiles,
  dataDirs,
  fileOffsets,
  stdioPolicy,
  healthProbe,
  refusalClasses,
};
```

The implementation may use more precise runtime names, but it must preserve these semantics.

### Resource status values

Each observed resource gets one status:

- `supported`: target-native reconstruction or validation is proven by a generic resource-class rule.
- `refused`: the resource is recognized but not yet supported; save/load must fail closed with exact evidence.
- `unknown`: the scanner cannot classify it safely; save/load must fail closed.
- `deferred`: the resource belongs to a planned frontier and is intentionally outside the current generic envelope.
- `ignorable`: the resource is proven irrelevant to target behavior, such as explicitly closed or non-semantic proof harness state.

A generic save is accepted only if all observed resources are `supported` or `ignorable`.

## Loader strategies

The generic framework names these strategies, in increasing ambition:

1. `reexec`: validate resources and re-run the same target-native executable with captured argv/env/cwd.
2. `target-native-restart`: restart a service from validated data/config state, as with static servers and the narrow PostgreSQL cluster envelope.
3. `brokered-fd`: recreate or broker an fd-backed resource class such as pipes, PTYs, or Unix sockets after that class graduates.
4. `continuation`: continue same-arch process state at a proven safe boundary after memory/register/fd models exist.

The first generic product row should use `reexec` or `target-native-restart`, not `continuation`.

## Success evidence

A generic support row must record:

- accepted save descriptor with `genericResourceGraphState` or equivalent generic state;
- exact executable identity and target-native policy;
- argv/env/cwd reconstruction evidence;
- target preflight validation for every supported resource class;
- target pid only after launch succeeds;
- health evidence, such as process-alive, HTTP response, TCP banner/connect, command probe, or protocol probe;
- retained JSON/timing matrix evidence.

## Refusal evidence

A generic refusal row must record:

- exact unsupported resource class and resource instance;
- whether refusal happened at capture/save, target validation, loader preflight, or health probe;
- no target loader launch for save-time refusal, or loader state `refused` with `targetPid=null` for target-side refusal;
- retained JSON/timing evidence.

Refusal is a product feature. Unsupported resources must be visible to users and tests, not papered over by a broad accepted state.

## First generic target

The first useful generic target is:

> Unknown target-native daemon with regular-file/data-dir state, loopback listener, no active clients, and an inferred or user-provided health probe.

Example UX remains normal `machinen move`:

```sh
machinen move save src <pid> app.bundle
machinen move load tgt app.bundle
```

The process can be accepted generically only if capture proves:

- target-native executable identity is known;
- argv/env/cwd are safe and portable;
- regular file fds are regular non-symlink files with stable identity;
- writable directories or data directories have portable tree identity and symlink policy;
- loopback TCP listeners have no active clients;
- target ports are free before launch;
- every other fd/resource is supported, ignorable, or refused.

## Existing envelope inventory

The existing matrix is not discarded. It is the source of graduated behavior.

The inventory file [`generic-resource-graph-inventory.json`](./generic-resource-graph-inventory.json) maps all current `scripts/smoke/move-envelope-matrix.sh` proof names into normalized resource classes. It now covers 159 proof rows with zero missing or duplicate proof names, including the first generic support/refusal rows.

Run the coverage guard with:

```sh
pnpm run generic-resource-graph-coverage
```

The guard reports the generic proof rows, migration-equivalence rows, missing/extra inventory entries, duplicates, missing required generic rows, and malformed migration mappings. It must fail before a consolidation change silently drops support or refusal evidence.

High-level mappings:

| Existing family                    | Normalized resource classes                                                                | Generic readiness                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Deterministic file/query tools     | process identity, argv/env/cwd, regular file identity, directory identity, atomic output   | pilot candidate                                  |
| Filesystem mutations               | precondition identity, filesystem mutation, postcondition                                  | needs mutation subclass                          |
| Archive/compression tools          | regular file/tree identity, atomic output, archive member policy                           | needs archive subclass                           |
| Static HTTP/read-only daemons      | executable/config/root identity, loopback listener, no active clients, health probe        | pilot candidate                                  |
| Single-file responders             | executable/argv, regular file identity, loopback listener, no active clients, health probe | pilot candidate                                  |
| Redis/PostgreSQL stateful services | listener, no active clients, data-dir identity, database safety, health probe              | generic shell plus specialized safety subclasses |
| Pipelines, shells, terminal tools  | process identity plus pipe/PTY refusal                                                     | frontier work                                    |
| Runtime-specific app refusals      | process/listener state plus runtime-specific refusal                                       | frontier work                                    |

The migration rule is conservative:

1. app-specific envelopes keep priority;
2. generic resource graph is attempted only when no bespoke envelope matches;
3. a generic proof may replace bespoke code only after equivalent support and refusal evidence exists;
4. coverage tooling must show which old proof names are covered by generic resource classes.

The first explicit migration-equivalence mappings are recorded in the inventory, not inferred from naming. They map six existing simple bespoke proof names (`python-http`, `python-http-directory`, `nc-listener`, `reader-cat`, `grep`, and `tail`) to generic proof rows with target evidence and a fallback policy that keeps the bespoke path active during migration.

## Service consolidation inventory

Wave 3 also records a service consolidation inventory for existing explicit envelopes. This is not a generic-primary promotion. Each candidate keeps its explicit envelope fallback until equivalent generic support and refusal rows exist.

| Existing envelope | Candidate generic resource classes                                                                           | Fallback boundary                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nginx-static`    | service config identity, static root identity, idle loopback listener, no active clients, health probe       | keep nginx loader until static config/root support plus active-client, dynamic config, port conflict, and package/root drift refusals are equivalent |
| `caddy-static`    | service config/static root identity, idle loopback listener, no active clients, health probe                 | keep Caddy loader until file-server-only support plus proxy/dynamic, port conflict, and package/root drift refusals are equivalent                   |
| `ruby-http`       | static root identity, idle loopback listener, no active clients, health probe, runtime-specific refusal      | keep Ruby loader until `ruby -run -e httpd` support plus Ruby app/runtime refusals are equivalent                                                    |
| `php-static`      | static root identity, idle loopback listener, no active clients, health probe, runtime-specific refusal      | keep PHP loader until static-only support plus dynamic script/router refusals are equivalent                                                         |
| `rsync-daemon`    | service config identity, read-only data root, idle loopback listener, no active clients, health/read probe   | keep rsync loader until read-only/no-auth module support plus writable/auth/config drift refusals are equivalent                                     |
| `redis-idle`      | service config identity, empty dataset safety, idle loopback listener, no active clients, PING/DBSIZE health | keep Redis loader until empty/no-persistence support plus active-client, nonempty, persistence, and config drift refusals are equivalent             |

The coverage guard validates these candidates through `genericServiceConsolidationCandidates` in the inventory so missing proof names, resource classes, fallback policies, or support/refusal evidence fields fail before a future consolidation can weaken the explicit envelopes.

Status/PR language for this phase must use the same boundary:

- Allowed: "Service consolidation inventory is recorded for `nginx-static`, `caddy-static`, `ruby-http`, `php-static`, read-only `rsync-daemon`, and empty/no-persistence `redis-idle` as explicit-envelope-fallback candidates only."
- Allowed: "Existing explicit service envelope loaders remain selected until equivalent generic support/refusal evidence exists for each listed candidate."
- Forbidden: broad daemon support, arbitrary process migration, any HTTP server support, any Redis/database state support, generic-primary service support without equivalent matrix rows, or support for active clients, writable persistence, unsupported modules, or runtime-specific state.

## Proven generic pilot rows

The first local support rows are deliberately small and target-native:

| Generic proof row                              | Resource shape                                                                                        | Target evidence                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `generic-yes-loop`                             | process identity + argv/cwd + process-alive probe                                                     | target `/proc/<pid>/cmdline` contains argv      |
| `generic-static-http-daemon`                   | cwd/data-dir identity + idle loopback HTTP listener                                                   | target HTTP GET returns static body             |
| `generic-interpreted-server`                   | idle loopback TCP listener                                                                            | target TCP request returns `interpreted:ping`   |
| `generic-file-backed-worker`                   | readonly regular file identity                                                                        | target log prints `file-worker:...`             |
| `generic-readonly-file-cli`                    | readonly-file CLI shape                                                                               | target log prints `readonly-cli:...`            |
| `generic-writable-log-daemon`                  | write-validated cwd/data-dir                                                                          | target appends `generic-log-entry`              |
| `generic-data-dir-daemon`                      | write-validated data-dir                                                                              | target writes `daemon-marker.txt`               |
| `generic-readonly-file-cursor`                 | read-only regular-file fd cursor                                                                      | target log starts at captured offset            |
| `generic-append-log-cursor`                    | exact `O_APPEND` regular-file fd captured at EOF                                                      | target appends `append-fd-entry` after load     |
| `generic-multi-file-readonly-worker`           | multiple read-only regular-file fd cursors                                                            | target log combines both captured offsets       |
| `generic-append-log-preflight-refusals`        | stale/truncated/missing target append log                                                             | loader refused with `targetPid=null`            |
| `generic-stale-file-identity-refusal`          | target file changed after capture                                                                     | loader refused with `targetPid=null`            |
| `generic-deleted-file-fd-refusal`              | deleted/unlinked regular-file fd                                                                      | no loader starts                                |
| `generic-writable-file-cursor-refusal`         | writable or unknown regular-file fd mode                                                              | no loader starts                                |
| `generic-append-only-file-cursor-refusal`      | append-only fd not captured at EOF                                                                    | no loader starts                                |
| `generic-append-log-unsupported-flags-refusal` | append fd with unsupported flags such as truncate                                                     | no loader starts                                |
| `generic-append-log-fanotify-refusal`          | append log plus fanotify follow interaction                                                           | no loader starts                                |
| `generic-file-lock-refusal`                    | descriptor-level advisory file-lock evidence                                                          | no loader starts                                |
| `generic-mmap-file-refusal`                    | mmap-backed mutable file state                                                                        | no loader starts                                |
| `generic-inotify-file-refusal`                 | inotify follow state                                                                                  | no loader starts                                |
| `generic-unix-socket-baseline-refusals`        | Unix pathname/abstract/datagram/socketpair/connected shapes                                           | no loader starts                                |
| `generic-unix-pathname-listener`               | idle pathname Unix listener with no active clients                                                    | target Unix socket accepts a probe connection   |
| `generic-unix-pathname-listener-refusals`      | active-client and occupied target pathname Unix listeners                                             | no target pid for pre-launch refusal            |
| `generic-anon-inode-baseline-refusals`         | eventfd/epoll/timerfd/inotify anon-inode shapes                                                       | no loader starts                                |
| `generic-eventfd-counter`                      | one normal-flag eventfd with modeled counter                                                          | target fdinfo shows reconstructed counter       |
| `generic-eventfd-counter-refusals`             | unsupported flags, oversized counter, waiter, alias                                                   | no loader starts                                |
| `generic-epoll-eventfd-watch`                  | one level-trigger epoll watch on the supported eventfd                                                | target fdinfo shows reconstructed watch         |
| `generic-epoll-eventfd-watch-refusals`         | unknown watch, edge, one-shot, nested, active loop                                                    | no loader starts                                |
| `generic-pty-transcript-probe`                 | proof-marked noninteractive PTY transcript/probe with termios/winsize/session/pgrp evidence           | target-native PTY reexec captures transcript    |
| `generic-pty-terminal-refusals`                | PTY-backed stdio, dirty editor/alternate-screen/job-control/foreground-pgrp/termios/winsize ambiguity | no loader starts; unsupported PTY state refused |
| `generic-service-php-static-parity`            | descriptor-harness generic PHP static service parity for one static-root loopback shape               | generic loader health plus pre-launch refusals  |
| `generic-unsupported-resource-refusals`        | unsupported resource classes                                                                          | no loader starts for pipe/PTY/socket/etc.       |
| `generic-loader-preflight-refusals`            | stale target/preflight/health failures                                                                | loader refused with `targetPid=null`            |

These rows do not claim arbitrary Python, arbitrary HTTP, arbitrary daemon, or arbitrary process migration. They prove the generic resource-class mechanism only for the observed resource graph in each row.

## Initial supported classes

The first generic classifier should graduate only resource classes already repeatedly proven by bespoke envelopes:

- executable identity and target-native binary/package policy;
- argv/env/cwd for safe command shapes;
- regular readonly file identity;
- read-only regular-file fd cursor continuation with captured fd number, access flags, source dev/inode/mtime evidence, offset, portable size/hash target preflight, target-side pre-open, `lseek`, and `dup2` reconstruction;
- narrow append-only regular-file fd continuation for exact `O_APPEND` log fds captured at EOF, target preflighted by portable size/hash identity, reopened with `O_WRONLY|O_APPEND|O_NOFOLLOW`, `dup2` reconstructed, and proven by target append progress;
- deterministic writable output with atomic replacement policy;
- symlink-free directory or tree identity;
- loopback TCP listener with no active clients;
- target port availability;
- static service root/config identity;
- data-dir identity when paired with a specialized safety subclass;
- health probe evidence.

## Initial refused/deferred classes

The first generic classifier must refuse or defer:

- active TCP connections;
- Unix domain sockets: idle pathname listeners have a narrow target-native reexec row only when the filesystem socket path is stable, no active Unix streams exist, the target path is absent, and a Unix-connect health probe passes; abstract namespace sockets, connected streams, socketpairs, and datagram sockets remain refused;
- pipes unless a proof-specific pipeline envelope handles them;
- PTYs and interactive terminal state; Wave 3 now records refusal-preserving PTY fd/path evidence and optional termios/winsize/session/process-group/foreground-pgrp/fd-flag evidence, but still refuses before target launch and makes no interactive terminal migration claim;
- anon inodes, now split for baseline refusal into eventfd, epoll/eventpoll, timerfd, signalfd, inotify, fanotify, io_uring, and unknown anon-inode state where observed; eventfd/epoll baseline descriptors record eventfd counters and epoll watched-fd metadata, while only the tiny one-eventfd normal-flag counter shape and one level-trigger epoll watch on that eventfd graduate to target-native reconstruction;
- devices except explicit allowlist entries;
- append-only log fd variants outside the exact EOF contract, including non-EOF offsets, truncate/unsupported flags, stale/truncated/rotated/missing target logs, concurrent writer ambiguity, lock/mmap interactions, and inotify/fanotify follow state;
- writable or unknown non-append regular-file fd modes;
- deleted/unlinked regular-file fds;
- file locks until modeled; current `generic-file-lock-refusal` is descriptor-level refusal evidence, not lock reconstruction;
- mmap dirty or mutable file-backed state until modeled;
- inotify/fanotify follow state until modeled; baseline rows prove inotify and classifier tests cover fanotify matching;
- runtime heap/thread/timer/worker state until modeled;
- source-ISA memory/register continuation.

## Frontier after generic pilot

The concrete follow-up contracts live in [`generic-resource-graph-frontier.md`](./generic-resource-graph-frontier.md).

The next resource classes to graduate, each requiring its own completion contract, are:

1. stdio and pipes;
2. PTY and terminal state;
3. Unix domain sockets;
4. remaining writable file cursors and append-log variants outside the exact EOF-only contract;
5. file locks;
6. epoll/kqueue readiness sets;
7. timers and signals;
8. mmap-backed file state;
9. same-arch memory/register continuation;
10. cross-arch target-native semantic reconstruction.

These are not implicitly supported by the generic resource graph. They are the frontier that reduces future refusal rates.
