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

## Final full-expansion boundary

Full expansion does not change the product boundary: generic move support is exact target-native resource graph support only. A supported row needs exact descriptors, target-native reconstruction or semantic reconstruction, visible target evidence, and equivalent refusal rows. If a resource class is unmodeled, unsafe, stale, or missing target-native support, the move must refuse before launch or finish with `targetPid=null`.

The final expansion explicitly preserves these non-claims:

- no arbitrary process restore;
- no broad daemon/database migration;
- no active session migration;
- no source-fd teleportation;
- no source-ISA emulation;
- no metadata-only success.

Same-arch continuation rows are proof-only and single-shape. Cross-arch rows are semantic-descriptor rows using target-native tools, not source register replay, runtime-profile shortcuts, or source-ISA execution.

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

Service graduation checklist:

| Candidate      | Support row                           | Refusal rows required before generic-primary                                             | Fallback status                     | Generic-primary status                        |
| -------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------- |
| `nginx-static` | `generic-service-nginx-static-parity` | active client, dynamic/FastCGI config, target root drift, port conflict, missing package | explicit fallback outside exact row | descriptor-harness parity; live-capture gated |
| `caddy-static` | `generic-service-caddy-static-parity` | reverse proxy, active client, target root drift, missing package, port conflict          | explicit fallback outside exact row | descriptor-harness parity; live-capture gated |
| `ruby-http`    | `generic-service-ruby-http-parity`    | custom Ruby socket app, active client, target root drift, runtime-specific state         | explicit fallback outside exact row | descriptor-harness parity; live-capture gated |
| `php-static`   | `generic-service-php-static-parity`   | dynamic script, active client, writable root/persistence, missing package                | explicit fallback outside exact row | descriptor-harness parity; live-capture gated |
| `rsync-daemon` | `generic-service-rsync-daemon-parity` | write-enabled module, auth/secrets, active client, config/root drift                     | explicit fallback outside exact row | descriptor-harness parity; live-capture gated |
| `redis-idle`   | `generic-service-redis-idle-parity`   | non-empty dataset, AOF/RDB persistence, active client, unsupported modules/config        | explicit fallback outside exact row | descriptor-harness parity; live-capture gated |

PHP descriptor-harness versus live-capture boundary:

| PHP evidence row                    | What it proves                                                              | Generic-primary status                             | Non-claim preserved                                      |
| ----------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `generic-service-php-static-parity` | Descriptor-harness static PHP shape can run under the generic reexec loader | allowed only inside the mutated descriptor harness | no live PHP promotion or broad PHP app migration         |
| `php-live-stdio-log-fd-refusal`     | Live PHP stdio/log fds keep generic refusalClasses non-empty                | refused / no target pid                            | no writable log fd, stdio, or runtime fd continuation    |
| `php-live-zend-semaphore-refusal`   | Live PHP deleted Zend semaphore fd keeps generic refusalClasses non-empty   | refused / no target pid                            | no deleted Zend semaphore or runtime tempfile migration  |
| `php-live-socket-fd-refusal`        | Live PHP socket fd mismatch keeps generic refusalClasses non-empty          | refused / no target pid                            | no unmodeled PHP socket migration or live generic launch |

The coverage guard validates these candidates through `genericServiceConsolidationCandidates` in the inventory so missing proof names, resource classes, fallback policies, or support/refusal evidence fields fail before a future consolidation can weaken the explicit envelopes.

Exact live product paths add a second marker. A descriptor-harness row such as `generic-service-nginx-static-parity` or an adjacent generic support row may prove the generic loader can run a synthetic shape, but it is not enough to preempt an explicit product loader. Product selection for generic-primary requires `migration.productPath.kind=exact-live-capture`, a live marker proof row, a descriptor support proof row, equivalent refusal proof rows, an exact observed graph label, and `refusalClasses=[]`. Without that metadata, explicit envelopes keep priority; if the explicit state is absent, the generic loader remains a proof-harness path rather than a documented live product claim.

### Productization phase 1 user-facing support matrix

Phase 1 exposes only one generic resource graph product route:

| Product route                       | Exact accepted shape                                                                                                                                                        | Required support/refusal evidence                                                                                                                                      | User-facing refusal classes / boundaries                                                                                                                                                                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generic-stdio-pipe-product-marker` | modeled finite stdio pipe graph with explicit captured bytes replayed into a target-native consumer; `migration.productPath.kind="exact-live-capture"`; `refusalClasses=[]` | support proof `generic-finite-pipe-buffer-replay`; refusal proof `generic-pipe-stdio-refusals`; retained coverage plan `move-envelope-productization-phase1-plan.json` | partial/unknown pipe writes, missing peers, fan-in/fan-out, shell state, PTY stdio, inherited stdio, stale preflight, loader failure, or any non-empty `refusalClasses` stay fail-closed; no arbitrary stdio migration, source-fd teleportation, active session migration, or arbitrary process restore. |

Everything else in the generic resource graph matrix is proof-only, refusal-only, or deferred until a later product contract proves a narrower route. In particular, same-arch modeled continuation and cross-arch semantic reconstruction are proof-only; Redis/database and service rows are deferred from phase 1; broad daemon/database migration, source-ISA emulation, metadata-only success, runtime-profile shortcuts, and active session migration are not product support.

Phase 1 validation is recorded in `scripts/smoke/move-envelope-productization-phase1-validation-profile.json`. Normal productization validation uses targeted proof-image rows for `generic-stdio-pipe-product-marker`, `generic-finite-pipe-buffer-replay`, and `generic-pipe-stdio-refusals`; retained coverage; productization coverage; generic coverage; proof-image boundary checks; smoke manifest integration; docs/API build; format, lint, typecheck; focused CLI/runtime Vitest; fallow audit; and `git diff --check`. The full all-proofs matrix remains manual/nightly/release scope. Full smoke tests remain skipped for docs/coverage/proof-row productization-only changes and run when VM lifecycle, VMM, rootfs/base assets, CLI boot/exec/mount, snapshot/restore lifecycle, virtio devices, memory/ballooning, FUSE/live mounts, or an explicit user request requires them.

### Productization wave 2 user-facing support matrix

Wave 2 adds exactly five product routes beyond phase 1. Each row still requires `migration.productPath.kind="exact-live-capture"`, `observedGraph="exact-live-resource-graph"`, `refusalClasses=[]`, target-visible proof evidence, retained artifacts under `/tmp/machinen-productization-wave2-retained-coverage`, the retained plan `scripts/smoke/move-envelope-productization-wave2-plan.json`, and the release validation profile `scripts/smoke/move-envelope-productization-wave2-validation-profile.json`.

| Product route                                        | Exact accepted shape                                                                                                                                    | Required support/refusal evidence                                                                                                                                                        | User-facing refusal classes / boundaries                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unix-pathname-listener-live-generic-primary-marker` | exact idle pathname Unix stream listener with stable socket path, writable parent, absent target path, no active clients, and Unix-connect health proof | support proof `generic-unix-pathname-listener`; refusal proof `generic-unix-pathname-listener-refusals`                                                                                  | connected sessions, abstract sockets, datagrams, socketpairs, fd passing, credential-sensitive sockets, occupied paths, missing parents, and path identity drift stay refused; no connected Unix session migration or source-fd teleportation |
| `reader-cat-live-generic-primary-marker`             | exact readonly `cat` regular-file cursor with deterministic target output redirected to the generic loader log                                          | support proof `reader-cat`; refusal proofs `generic-stale-file-identity-refusal`, `generic-deleted-file-fd-refusal`, and `generic-writable-file-cursor-refusal`                          | stale, deleted, writable, or changed backing files stay refused; no FIFO/stdout fd continuation, writable file fd continuation, or arbitrary command migration                                                                                |
| `grep-live-generic-primary-marker`                   | exact readonly `grep` regular-file cursor with captured literal pattern argv and deterministic target output                                            | support proof `grep`; refusal proofs `generic-stale-file-identity-refusal`, `generic-deleted-file-fd-refusal`, `generic-writable-file-cursor-refusal`, and `generic-pipe-stdio-refusals` | stale/deleted/writable files, unsafe pipe/stdio, shell pipelines, PTYs, and unsupported grep shapes stay refused; no shell pipeline state migration or mutable input repair                                                                   |
| `busybox-nc-listener-live-generic-primary-marker`    | exact idle `/usr/bin/busybox nc -l -p <port>` loopback listener with no active clients, modeled dev-null/log stdio, and target receive proof            | support proof `busybox-nc-listener`; refusal proofs `unsafe-busybox-nc-refusal`, `unsafe-nc-active-refusal`, and `generic-loader-preflight-refusals`                                     | active TCP clients, non-BusyBox listeners, port conflicts, missing target package/preflight failures, and hidden shell state stay refused; no active TCP session or broad daemon migration                                                    |
| `socat-file-responder-live-generic-primary-marker`   | exact idle `socat TCP-LISTEN:<port>,fork,reuseaddr FILE:<file>` responder with stable response-file identity and no active clients                      | support proof `socat-file-responder`; refusal proofs `unsafe-socat-file-responder-refusal` and `generic-loader-preflight-refusals`                                                       | active clients, changed response files, unsupported socat argv, port conflicts, and missing target socat stay refused; no arbitrary socat graph or active socket session migration                                                            |

The retained wave-2 artifact set is exactly the 19 proof names from `scripts/smoke/move-envelope-productization-wave2-plan.json`: `unix-pathname-listener-live-generic-primary-marker`, `generic-unix-pathname-listener`, `generic-unix-pathname-listener-refusals`, `reader-cat-live-generic-primary-marker`, `reader-cat`, `generic-stale-file-identity-refusal`, `generic-deleted-file-fd-refusal`, `generic-writable-file-cursor-refusal`, `grep-live-generic-primary-marker`, `grep`, `generic-pipe-stdio-refusals`, `busybox-nc-listener-live-generic-primary-marker`, `busybox-nc-listener`, `unsafe-busybox-nc-refusal`, `unsafe-nc-active-refusal`, `generic-loader-preflight-refusals`, `socat-file-responder-live-generic-primary-marker`, `socat-file-responder`, and `unsafe-socat-file-responder-refusal`. Productization validation must run targeted proof-image rows for that set, retained coverage, productization coverage, generic coverage, proof-image boundary checks, smoke manifest integration, docs/API build, format, lint, typecheck, focused CLI/runtime Vitest, fallow audit, and `git diff --check`. The full all-proofs matrix remains manual/nightly/release scope, and full smoke tests stay conditional on VM/VMM/rootfs/CLI boot-exec-mount/snapshot/virtio/memory/FUSE changes or explicit request.

Wave 2 does not promote the other 15 candidates. `generic-readonly-file-cursor`, `generic-append-log-cursor`, `generic-unix-pathname-client-pair`, `generic-file-lock-advisory`, and `generic-timerfd-relative-oneshot` remain deferred until missing product/refusal/enclosing evidence is proven. `node-static-http-live-generic-primary-marker`, `go-static-http-live-generic-primary-marker`, `rust-static-http-live-generic-primary-marker`, and `busybox-httpd-live-generic-primary-marker` remain blocked by full source/target tree identity. `nginx-live-generic-primary-marker`, `caddy-live-generic-primary-marker`, `ruby-live-generic-primary-marker`, `rsync-live-generic-primary-marker`, and `redis-live-generic-primary-marker` remain blocked by service/database safety. `tail-live-generic-primary-marker` remains blocked by active follow/session and concurrent-writer semantics.

Known productization blockers are recorded in `docs/snapshot/generic-resource-graph-productization-blockers.json` and are explicitly deferred for phase 1:

| Blocker                                   | Phase-1 status                                                                                                                                 | Product boundary                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| remote amd64 proof host availability      | deferred; `friend@100.126.46.90` currently reports `uname -m=aarch64`                                                                          | no remote amd64 success claim from that host                                                                               |
| PHP live-capture generic-primary blockers | deferred by writable stdio/log fds, deleted Zend semaphore fd, and unmodeled socket fd                                                         | no live PHP promotion, no writable log fd continuation, no deleted Zend semaphore migration, no unmodeled socket migration |
| Node static full tree digest identity     | deferred until source/target tree digest policy and digest-drift refusals are proven                                                           | no Node static HTTP generic product support in phase 1                                                                     |
| broad database/service/session movement   | deferred until each exact service/database/session shape has support, equivalent refusals, inventory/docs registration, and retained artifacts | no broad daemon/database/service migration and no active session migration                                                 |

Wave 1 product-path runtime-owned fd boundaries:

| Product path row                                     | Runtime-owned fd model                                                                                                                           | Refusals / non-claims                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-static-http-live-generic-primary-marker`       | Node/libuv epoll, eventfd, internal pipes, listener socket, and log stdio are recreated by target reexec                                         | no source libuv fd teleportation; timers, workers, native addons, and active clients remain refused                                                                    |
| `go-static-http-live-generic-primary-marker`         | Go runtime listener/socket/log stdio and runtime fds are recreated by target reexec                                                              | no arbitrary Go process migration; extra sockets remain refused by `go-extra-socket-refusal`                                                                           |
| `rust-static-http-live-generic-primary-marker`       | Rust static HTTP listener/socket/log stdio are recreated by target reexec                                                                        | no arbitrary native process migration; active sessions and extra runtime/socket behavior remain out of the exact row                                                   |
| `busybox-httpd-live-generic-primary-marker`          | BusyBox httpd listener socket and log stdio are recreated by exact target reexec                                                                 | only explicit `127.0.0.1:<port>` static-root httpd is promoted; wildcard binds, CGI/dynamic behavior, active clients, missing roots, and port conflicts remain refused |
| `busybox-nc-listener-live-generic-primary-marker`    | BusyBox nc listener socket and log stdio are recreated by exact target reexec                                                                    | active clients, non-BusyBox nc, hidden shell state, and unsupported listener shapes remain refused                                                                     |
| `socat-file-responder-live-generic-primary-marker`   | socat listener sockets, auxiliary Unix datagram noise, response file open, and log stdio are recreated by exact target reexec                    | active clients, changed response files, port conflicts, missing socat, and unsupported socat argv remain refused                                                       |
| `unix-pathname-listener-live-generic-primary-marker` | Unix pathname listener socket is recreated at a stable filesystem path by exact target reexec                                                    | connected sessions, abstract/datagram sockets, occupied paths, missing parents, and non-writable parents remain refused                                                |
| `reader-cat-live-generic-primary-marker`             | readonly file cursor is reopened on target stdin at the captured offset and stdout is target generic-loader log output                           | no source FIFO/stdout fd continuation, writable cursor, stale/deleted file, or arbitrary cat process migration                                                         |
| `grep-live-generic-primary-marker`                   | readonly file cursor is reopened on target stdin at the captured offset with literal pattern argv and stdout as target generic-loader log output | no stdin/pipe continuation, unsupported grep options, writable/stale/deleted file, or arbitrary grep process migration                                                 |
| `tail-live-generic-primary-marker`                   | tail follow is restarted from the captured append cursor and target appends are observed in the generic-loader log                               | no source inotify fd continuation, concurrent-writer consistency model, mutable data replay, or broad tail process migration                                           |

These rows intentionally model exact marker-proven static HTTP/listener/file-cursor reexec, not source-fd continuation. Full source/target tree digest identity remains deferred for Node/native static HTTP product paths unless a later row proves it explicitly; BusyBox httpd product rows require stable root identity and an explicit loopback bind.

Service-specific resource/refusal class alignment:

| Class                        | Current service evidence                                                                                                                                            | Boundary                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `serviceReadOnlyData`        | `generic-service-rsync-daemon-parity` and `rsync-live-generic-primary-marker`                                                                                       | only read-only/no-auth rsync module roots; write-enabled modules stay refused as `serviceWritablePersistence`                         |
| `serviceEmptyDataset`        | `generic-service-redis-idle-parity` and `redis-live-generic-primary-marker`                                                                                         | only empty Redis datasets with persistence disabled and DBSIZE=0 target proof                                                         |
| `databaseSafety`             | `generic-service-redis-idle-parity` and `redis-live-nonempty-marker-refusal`                                                                                        | non-empty Redis datasets fail closed with `targetPid=null`; no database state migration claim                                         |
| `serviceManagedChildWorkers` | `service-managed-child-worker-refusal`                                                                                                                              | live service-managed worker/process trees remain refused; no broad process-tree or worker-pool reconstruction claim                   |
| `serviceConfigDrift`         | `service-config-drift-refusal` and `service-per-service-drift-refusals`                                                                                             | service config, argv contract, or module config drift keeps generic service descriptors refused with `targetPid=null`                 |
| `targetPackageMissing`       | `service-target-package-missing-normalization`, `generic-loader-preflight-refusals`, `generic-service-caddy-static-parity`, and `generic-service-php-static-parity` | missing target-native service packages/executables fail closed before target continuation; explicit fallback behavior is not weakened |

Status/PR language for this phase must use the same boundary:

- Allowed: "Service consolidation inventory is recorded for `nginx-static`, `caddy-static`, `ruby-http`, `php-static`, read-only `rsync-daemon`, and empty/no-persistence `redis-idle` as explicit-envelope-fallback candidates only."
- Allowed: "Existing explicit service envelope loaders remain selected until equivalent generic support/refusal evidence exists for each listed candidate."
- Forbidden: broad daemon support, arbitrary process migration, any HTTP server support, any Redis/database state support, generic-primary service support without equivalent matrix rows, or support for active clients, writable persistence, unsupported modules, or runtime-specific state.

### Service-generic validation profile

Normal service-generic validation is targeted. It does not run the full move-envelope matrix by default. Use:

1. targeted proof-image rows for the service changes under test, usually the rows listed in `scripts/smoke/move-envelope-service-generic-plan.json`;
2. retained-artifact coverage with `pnpm move-envelope:service-generic` and `MACHINEN_MOVE_SERVICE_GENERIC_COVERAGE_DIR=<retained-output-dir>`;
3. `pnpm run generic-resource-graph-coverage` for inventory/support/refusal drift;
4. `bash -n scripts/smoke/move-envelope-matrix.sh` and `node --check scripts/generic-resource-graph-coverage.mjs scripts/move-envelope-matrix-coverage.mjs scripts/validation-profile.mjs scripts/build-move-proof-image.mjs` for script syntax;
5. repository static checks (`pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`) and focused unit tests for touched TypeScript.

The retained service plan covers the live marker/blocker rows (`nginx-live-generic-primary-marker`, `service-managed-child-worker-refusal`, Caddy/Ruby/rsync/Redis live marker and refusal rows, PHP live blocker rows) plus service normalization/drift rows (`service-config-drift-refusal`, `service-target-package-missing-normalization`, and `service-per-service-drift-refusals`). Full all-proofs matrix execution remains manual/nightly/release scope, not normal PR validation.

## Proven generic pilot rows

The first local support rows are deliberately small and target-native:

| Generic proof row                              | Resource shape                                                                                                                                                          | Target evidence                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `generic-yes-loop`                             | process identity + argv/cwd + process-alive probe                                                                                                                       | target `/proc/<pid>/cmdline` contains argv      |
| `generic-two-process-pipe-reexec`              | exact two-node processGraph plus one producer-to-consumer pipeGraph, target-native reexec                                                                               | target consumer log prints producer output      |
| `generic-finite-pipe-buffer-replay`            | finite captured pipe bytes replayed into a target-native consumer                                                                                                       | target `wc -c` output matches captured bytes    |
| `generic-stdio-pipe-product-marker`            | exact modeled stdio pipe productPath marker with support/refusal proof names and `refusalClasses=[]`                                                                    | target output succeeds; unsafe sibling refused  |
| `generic-pipe-stdio-refusals`                  | partial/unknown pipe writes, missing peers, fan-in, shell state, PTY stdio, inherited stdio, stale preflight, and loader failure cases                                  | no target pid or no loader starts               |
| `generic-multi-process-pipe-refusals`          | missing peer, fan-in/out, nonblocking, shell/PTY/stdio, stale, and active partial pipe cases                                                                            | no target pid for unsafe variants               |
| `generic-process-tree-refusals`                | service-managed children, dynamic worker pools, active requests, reload races, non-exact trees                                                                          | no loader starts and no target pid              |
| `generic-service-process-tree-prefork`         | proof-only exact prefork master/worker service tree with config identity and no active requests                                                                         | target worker observed plus HTTP health         |
| `generic-service-process-tree-refusals`        | dynamic workers, active requests, reload races, service-managed children outside exact graph, writable persistence, config/package mismatch                             | no target pid or no loader starts               |
| `generic-static-http-daemon`                   | cwd/data-dir identity + idle loopback HTTP listener                                                                                                                     | target HTTP GET returns static body             |
| `generic-interpreted-server`                   | idle loopback TCP listener                                                                                                                                              | target TCP request returns `interpreted:ping`   |
| `generic-file-backed-worker`                   | readonly regular file identity                                                                                                                                          | target log prints `file-worker:...`             |
| `generic-readonly-file-cli`                    | readonly-file CLI shape                                                                                                                                                 | target log prints `readonly-cli:...`            |
| `generic-writable-log-daemon`                  | write-validated cwd/data-dir                                                                                                                                            | target appends `generic-log-entry`              |
| `generic-data-dir-daemon`                      | write-validated data-dir                                                                                                                                                | target writes `daemon-marker.txt`               |
| `generic-database-data-dir-refusals`           | unsafe database/data-dir states: WAL ambiguity, active writers, locks, persistence, dirty checkpoints, owner/mode drift, symlinks, service-specific features            | no target pid / no generic launch               |
| `generic-same-arch-modeled-continuation`       | proof-only single-thread same-arch native code shape with frozen thread/register/stack/memory/fd compatibility evidence                                                 | target-native code returns expected value       |
| `generic-same-arch-continuation-refusals`      | unsafe same-arch continuation states: active syscalls, multiple threads, unsupported mappings, runtime heaps, signal state, unsupported fds, graph gaps                 | no target pid / no loader start                 |
| `generic-cross-arch-semantic-reconstruction`   | proof-only finite byte-stream semantic descriptor reconstructed by a target-native tool on a different target architecture                                              | target-visible transformed output               |
| `generic-cross-arch-semantic-refusals`         | unsafe cross-arch claims: metadata-only success, source-ISA emulation, runtime profiles, arbitrary ELF/process claims, unsupported resources, missing tools, graph gaps | no target pid / no target-native launch         |
| `generic-unix-pathname-client-pair`            | exact pathname Unix listener plus target-created protocol client probe with stable path and no connected session claim                                                  | target Unix protocol response observed          |
| `generic-unix-socket-wave2-refusals`           | connected sessions, abstract sockets, datagrams, socketpairs, fd-passing, credential-sensitive sockets, occupied/missing/changed paths                                  | no target pid or no loader starts               |
| `generic-readonly-file-cursor`                 | read-only regular-file fd cursor                                                                                                                                        | target log starts at captured offset            |
| `generic-append-log-cursor`                    | exact `O_APPEND` regular-file fd captured at EOF                                                                                                                        | target appends `append-fd-entry` after load     |
| `generic-multi-file-readonly-worker`           | multiple read-only regular-file fd cursors                                                                                                                              | target log combines both captured offsets       |
| `generic-append-log-preflight-refusals`        | stale/truncated/missing target append log                                                                                                                               | loader refused with `targetPid=null`            |
| `generic-stale-file-identity-refusal`          | target file changed after capture                                                                                                                                       | loader refused with `targetPid=null`            |
| `generic-deleted-file-fd-refusal`              | deleted/unlinked regular-file fd                                                                                                                                        | no loader starts                                |
| `generic-writable-file-cursor-refusal`         | writable or unknown regular-file fd mode                                                                                                                                | no loader starts                                |
| `generic-append-only-file-cursor-refusal`      | append-only fd not captured at EOF                                                                                                                                      | no loader starts                                |
| `generic-append-log-unsupported-flags-refusal` | append fd with unsupported flags such as truncate                                                                                                                       | no loader starts                                |
| `generic-append-log-fanotify-refusal`          | append log plus fanotify follow interaction                                                                                                                             | no loader starts                                |
| `generic-file-lock-advisory`                   | one exact flock whole-file advisory lock with path/file identity and owner policy                                                                                       | target lock is reacquired; conflict probe fails |
| `generic-file-lock-refusal`                    | descriptor-level advisory file-lock evidence                                                                                                                            | no loader starts                                |
| `generic-file-lock-refusals`                   | lock conflict, changed backing file, unknown owner, mandatory/lease/range/type/cross-process cases                                                                      | no target pid or no loader starts               |
| `generic-mmap-file-backed-clean`               | one clean read-only/MAP_SHARED file-backed mapping with path/offset/length and file identity                                                                            | target mapped bytes are visible in loader log   |
| `generic-mmap-dirty-refusals`                  | dirty shared/private, anonymous dirty, writable-exec, truncation race, changed backing file                                                                             | no target pid or no loader starts               |
| `generic-mmap-file-refusal`                    | mmap-backed mutable file state                                                                                                                                          | no loader starts                                |
| `generic-inotify-file-follow`                  | one IN_MODIFY inotify watch on a stable regular file                                                                                                                    | target append is observed in loader log         |
| `generic-inotify-fanotify-refusals`            | queued/dropped events, directory races, recursive watches, changed identity, fanotify permission, masks                                                                 | no target pid or no loader starts               |
| `generic-inotify-file-refusal`                 | inotify follow state outside the exact file-follow contract                                                                                                             | no loader starts                                |
| `generic-unix-socket-baseline-refusals`        | Unix pathname/abstract/datagram/socketpair/connected shapes                                                                                                             | no loader starts                                |
| `generic-unix-pathname-listener`               | idle pathname Unix listener with no active clients                                                                                                                      | target Unix socket accepts a probe connection   |
| `generic-unix-pathname-listener-refusals`      | active-client and occupied target pathname Unix listeners                                                                                                               | no target pid for pre-launch refusal            |
| `generic-anon-inode-baseline-refusals`         | eventfd/epoll/timerfd/inotify anon-inode shapes                                                                                                                         | no loader starts                                |
| `generic-eventfd-counter`                      | one normal-flag eventfd with modeled counter                                                                                                                            | target fdinfo shows reconstructed counter       |
| `generic-eventfd-counter-refusals`             | unsupported flags, oversized counter, waiter, alias                                                                                                                     | no loader starts                                |
| `generic-epoll-eventfd-watch`                  | one level-trigger epoll watch on the supported eventfd                                                                                                                  | target fdinfo shows reconstructed watch         |
| `generic-epoll-timerfd-watch`                  | one level-trigger epoll watch on the supported relative one-shot timerfd                                                                                                | target epoll readiness and timer read observed  |
| `generic-epoll-eventfd-watch-refusals`         | unknown watch, edge, one-shot, nested, active loop, unsupported flags, incompatible counters                                                                            | no loader starts                                |
| `generic-timerfd-relative-oneshot`             | one normal-flag `CLOCK_MONOTONIC` relative one-shot timerfd with captured remaining expiry                                                                              | target-native timer fires within bounded skew   |
| `generic-timerfd-relative-oneshot-refusals`    | realtime, nonblocking, unread, absolute, and periodic timerfd variants                                                                                                  | no loader starts                                |
| `generic-signalfd-signal-state-refusals`       | signalfd, pending signal, process-group ambiguity, runtime signal timer, and unknown handler state                                                                      | no loader starts                                |
| `generic-pty-transcript-probe`                 | proof-marked noninteractive PTY transcript/probe with termios/winsize/session/pgrp evidence                                                                             | target-native PTY reexec captures transcript    |
| `generic-pty-terminal-refusals`                | PTY-backed stdio, dirty editor/alternate-screen/job-control/foreground-pgrp/termios/winsize ambiguity                                                                   | no loader starts; unsupported PTY state refused |
| `generic-service-nginx-static-parity`          | descriptor-harness generic nginx static service parity for one static-root loopback shape                                                                               | generic loader health plus pre-launch refusals  |
| `generic-service-caddy-static-parity`          | descriptor-harness generic Caddy static file-server parity for one static-root shape                                                                                    | generic loader health plus pre-launch refusals  |
| `generic-service-ruby-http-parity`             | descriptor-harness generic Ruby `-run -e httpd` parity for one static-root loopback shape                                                                               | generic loader health plus pre-launch refusals  |
| `php-live-stdio-log-fd-refusal`                | live PHP stdio/log fd generic blocker                                                                                                                                   | no generic loader target pid                    |
| `php-live-zend-semaphore-refusal`              | live PHP deleted Zend semaphore fd generic blocker                                                                                                                      | no generic loader target pid                    |
| `php-live-socket-fd-refusal`                   | live PHP socket fd mismatch generic blocker                                                                                                                             | no generic loader target pid                    |
| `generic-service-php-static-parity`            | descriptor-harness generic PHP static service parity for one static-root loopback shape                                                                                 | generic loader health plus pre-launch refusals  |
| `generic-service-rsync-daemon-parity`          | descriptor-harness generic rsync daemon parity for one read-only no-auth module shape                                                                                   | generic loader health/read plus refusals        |
| `generic-service-redis-idle-parity`            | descriptor-harness generic Redis idle parity for one empty no-persistence loopback shape                                                                                | generic loader PING/DBSIZE plus refusals        |
| `generic-unsupported-resource-refusals`        | unsupported resource classes                                                                                                                                            | no loader starts for pipe/PTY/socket/etc.       |
| `generic-loader-preflight-refusals`            | stale target/preflight/health failures                                                                                                                                  | loader refused with `targetPid=null`            |

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
- pipes unless they match an exact graduated processGraph/pipeGraph row (`generic-two-process-pipe-reexec`, `generic-finite-pipe-buffer-replay`, or `generic-stdio-pipe-product-marker`); fan-in/fan-out, nonblocking endpoints, shell state, PTY stdio, stale executable/cwd, active partial writes, and non-exact process trees remain refused;
- PTYs and interactive terminal state; Wave 3 now records refusal-preserving PTY fd/path evidence and optional termios/winsize/session/process-group/foreground-pgrp/fd-flag evidence, but still refuses before target launch and makes no interactive terminal migration claim;
- anon inodes and signal state, now split for baseline refusal into eventfd, epoll/eventpoll, timerfd, signalfd, inotify, fanotify, io_uring, and unknown anon-inode state where observed; eventfd/epoll/timerfd/signalfd baseline descriptors record eventfd counters, epoll watched-fd metadata, timerfd clock/deadline fields, signalfd masks, and process signal masks/dispositions where relevant, while only the tiny one-eventfd normal-flag counter shape, one level-trigger epoll watch on that eventfd, and one normal-flag `CLOCK_MONOTONIC` relative one-shot timerfd with zero interval/no unread ticks graduate to target-native reconstruction; signalfd, pending signal delivery, process-group ambiguity, runtime-managed signal timers, and unknown handlers remain refused;
- devices except explicit allowlist entries;
- append-only log fd variants outside the exact EOF contract, including non-EOF offsets, truncate/unsupported flags, stale/truncated/rotated/missing target logs, concurrent writer ambiguity, lock/mmap interactions, and inotify/fanotify follow state;
- writable or unknown non-append regular-file fd modes;
- deleted/unlinked regular-file fds;
- file locks except the proof-only `generic-file-lock-advisory` row for one exact flock whole-file advisory lock reacquired before target launch; conflicts, unknown owners, mandatory locks, leases, POSIX/OFD variants, byte-range variants, and cross-process ownership ambiguity remain refused;
- mmap state except the proof-only `generic-mmap-file-backed-clean` row for one clean file-backed read-only/shared mapping; dirty pages, anonymous mappings, copy-on-write state, writable executable mappings, truncation races, and changed backing files remain refused;
- inotify/fanotify follow state except the proof-only `generic-inotify-file-follow` row for one future IN_MODIFY event on one stable regular file; queued event replay, recursive watches, directory mutation races, fanotify permission events, unsupported masks, and broad watcher migration remain refused;
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
