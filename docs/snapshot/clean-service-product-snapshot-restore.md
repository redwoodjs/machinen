# Clean-service product snapshot/restore

Goal 49 generalizes the Goal 47 Node product path into a shared clean-service
contract. The user workflow stays:

```sh
machinen snapshot <vm> <bundle>
machinen restore <bundle>
```

No `capture`, `--portable`, `--runtime`, `--language`, or proof summary is part of
the product path.

## What is supported

A clean service is a process that Machinen can safely reconstruct target-natively
on another CPU architecture. The current implemented clean-service subsets are:

- `node-http-clean-root-v1`
- `python-http-clean-root-v1`
- `go-http-clean-root-v1` for statically linked HTTP services built without cgo

The service must have a captured app root, reconstructable argv/cwd/env, a known
runtime version or static-binary policy, a listening HTTP endpoint that can be
rebound, and a verifier whose output hash is checked on the target before
success.

## Bundle files

A portable clean-service snapshot adds these files to the normal snapshot bundle:

- `portable-clean-service.json` — shared service manifest, source architecture,
  route policy, component report, provenance, verifier, digests, and security
  assertions.
- `clean-service-<runtime>-primary.tar.gz` — captured service root artifact.
- `meta.json.portable` — human/audit-friendly component summary.

## Restore behavior

When `machinen restore <bundle>` sees `portable-clean-service.json` and the target
architecture differs from the source architecture, it boots a target-native VM,
selects the required runtime, materializes the app artifact, starts the service,
and runs the verifier. Only then does it report:

```json
{ "migrationCompleted": true, "targetVerifierResult": "passed" }
```

Success asserts that source-ISA emulation, source-text replay as restore, sidecar
runtime success, app hooks, and metadata-only continuation were not used.

## Kernel-state support-or-refusal model

Clean-service snapshot inspection records kernel resources as `supported`,
`irrelevant`, or `refused`. Supported state is either captured with integrity,
recreated by target-native service startup, or rebound by the service verifier
model. Irrelevant state, such as stdio redirection, is documented as outside the
clean-service continuation boundary. Refused state fails snapshot before a bundle
is advertised as portable.

Examples of supported/resolved state include read-only files under the captured
app root, expected listener sockets, runtime epoll/eventfd state recreated by
normal process startup, expected distro/runtime shared libraries covered by the
target runtime policy, and static Go binaries with no ELF program interpreter.
Refusals include deleted-but-open files, unproven open files outside the app
root, active TCP/TLS/websocket streams, unexpected listeners, unmodeled Unix
sockets, timerfd/signalfd state, writable shared mappings, mmapped DB/WAL files,
child-worker process topologies, writable host-mounted app roots, app native
addons, Python C extensions, cgo, and dynamically linked Go service binaries.

## Why these refusals are special

These refusals are special because they are not ordinary app errors. They are
places where the kernel is holding state that the clean-service contract cannot
honestly recreate by untarring app files and restarting a target-native process.
If Machinen ignored them, restore could appear to work while silently dropping
bytes, connections, locks, deadlines, private memory, or process relationships.

The rule is: support is allowed when the state is captured with provenance,
recreated by normal target startup, closed or drained with verifier proof, or
shown to be outside the service boundary. Everything else must fail closed.

- Open files outside the app root may be hidden inputs. They need explicit
  immutable provenance or they are refused.
- Deleted-but-open files have no stable path to recapture. They are refused
  unless a future model proves they are disposable temp state.
- Active TCP/TLS/websocket streams contain peer-visible protocol state. They must
  be drained, reconnected, or refused.
- Unix sockets, pipes, epoll, eventfd, timerfd, and signalfd are kernel object
  graphs. They need a descriptor/recreate model before support.
- Shared mappings and mmapped DB/WAL files can carry dirty durable state outside
  normal file digests. They need service-specific consistency proofs.
- Child workers and shared process groups change the continuation boundary from
  one service process to a process group. They need explicit membership and
  verifier semantics.
- Writable host mounts can change behind the snapshot. They need read-only
  immutable provenance or are refused.
- Native extensions, cgo, and dynamic Go binaries can hide architecture-specific
  private state. They need native dependency provenance or are refused.

## Refusal examples and support boundaries

These examples show when a refusal fires and what would be needed to support the
same shape later.

### Immutable input files outside the app root

Works when the file is a true input, not mutable service state. For example, a
service under `/opt/app` reads `/etc/machinen/service-config.json` at startup and
keeps it open read-only. That can be supported if the manifest declares the file
or containing directory as an immutable input, records its digest, records where
it came from, and restores the same bytes on the target.

Refuses when the file might change or carry durable state. For example,
`/var/lib/my-service/cache.db`, `/tmp/session.json`, or a writable config file
outside the captured root is refused because Machinen cannot prove which bytes
belong to the portable app snapshot.

### Deleted-but-open files

Refuses when a process still has `/tmp/foo (deleted)` open. The path no longer
names the bytes, so the target cannot reopen it by path. This might become
supportable only for anonymous scratch files that are proven disposable and not
read after restart.

### Active TCP/TLS/websocket streams

Refuses when `/proc/net/tcp*` shows the service fd in `ESTABLISHED`,
`CLOSE_WAIT`, or another non-listening state. The kernel and peer share sequence
numbers, unread bytes, TLS keys, websocket frames, and close semantics. Support
requires draining or closing the stream before capture and proving the verifier
still passes after clients reconnect.

### Unexpected listeners

Works for the declared clean-service HTTP listener, such as port `3000`, because
the target-native process can bind it again and the verifier checks it. Refuses
when the same process also listens on an undeclared admin/debug/metrics port.
That second port needs to be added to the component model and verifier before it
can be supported.

### Unix sockets, pipes, and FIFOs

Refuses for unmodeled local IPC such as `/tmp/app.sock`, named pipes, or a
socketpair to another process. These are kernel object graphs, not files. A Unix
control socket could become supportable if the app recreates it at startup and
the verifier proves the control path still works.

### epoll and eventfd

Can be treated as supported when they are runtime startup state and every watched
fd is already modeled, such as the expected HTTP listener. Refuses when epoll is
watching an unmodeled pipe, Unix socket, timerfd, signalfd, or external fd. The
important question is not “does epoll exist?” but “can all watched resources be
recreated safely?”

### timerfd, signalfd, and pending signals

Refuses when correctness depends on a kernel deadline or pending signal crossing
the snapshot boundary. A timer created again by normal app startup can be fine,
but a half-expired timerfd with business meaning needs replay rules before it is
supportable.

### Shared memory and mmapped DB/WAL files

Refuses for writable shared mappings, SysV/POSIX shared memory, or mmapped files
that look like database/WAL state. These can contain dirty state that is not
captured by normal file digests. Support should use a service-specific logical
capture path, like the PostgreSQL product path, rather than clean-service byte
copy.

### Process groups and workers

Works for exactly one primary service process. Refuses when child workers,
helpers, or shared process groups are required for correctness. Support needs an
explicit process-group manifest with membership, startup order, health checks,
and verifier coverage for the whole group.

### Host mounts

Works for normal guest filesystem paths captured into the app artifact. A
read-only host mount can become supportable if every referenced file is captured
or declared immutable with digest/provenance. Writable host mounts refuse because
the host can change state behind the snapshot.

### Native extensions, cgo, and dynamic Go binaries

Works for pure JS/Python app code and static Go binaries with no ELF program
interpreter. Refuses for Node `.node` addons, Python `.so` extensions, cgo, and
dynamically linked Go service binaries unless a future model records target
builds, ABI, package/layer digests, loaded libraries, and proves no native
private state must survive.

## Target runtime policy

Each component records a target runtime provisioning contract. The supported
contracts are:

- runtime already present on the target image;
- an explicit Debian package set installed by normal `apt-get install`;
- a future bundled runtime layer with digest and provenance.

Node and Python use exact major/minor compatibility with patch-compatible target
versions. For example, Python 3.11.2 may restore onto Python 3.11.8, but not
Python 3.12.x. Go uses `none-static-binary`: the app artifact must include a
statically linked executable under the captured root, and binaries with
`CGO_ENABLED=1` or dynamic linkage are refused.

## Refusals

Machinen refuses unknown or unsafe state with `migrationCompleted=false`. Generic
refusals include open fd ambiguity, deleted open files, active TCP/TLS sessions,
Unix sockets, unexpected listeners, epoll/eventfd/timerfd/signalfd ambiguity,
shared memory, mmapped durable DB/WAL state, child process trees, missing
verifiers, digest tamper, target architecture mismatch, runtime policy mismatch,
host-mounted dirty state, dirty persistent database/WAL state, native extension
state, runtime private state, package provenance drift, process groups, and
unavailable target runtime.

Runtime-specific detections are normalized under generic clean-service categories.
For example, both `python-active-tcp-session-unsupported` and
`node-active-tcp-session-unsupported` report
`clean-service-active-session-unsupported` to users. Runtime details may still be
kept as aliases for debugging.

## What this is not

Clean-service restore is not live process teleportation. These examples are
intentionally refused:

- active websocket or TLS sessions that need in-memory keys or stream sequence;
- databases with dirty pages, active transactions, or WAL that needs replay;
- worker pools, child processes, or IPC trees that must move as a group;
- Node native addons, Python `.so` extensions, cgo, or dynamically linked Go
  libraries without explicit provenance;
- runtime-private debug state such as a Node inspector session.

## Remediation

Drain active connections before snapshot. Stop websocket/TLS clients and let them
reconnect after restore. Close deleted temp files and unneeded descriptors. Move
required input files under the captured app root or declare immutable provenance.
Quiesce databases, checkpoint WAL, or use a logical service-specific capture such
as the PostgreSQL product path. Stop child workers or run one accepted service
component until process groups are supported. Avoid writable host-mounted app
roots. Rebuild native extensions for the target with explicit provenance, or
rebuild Go services with `CGO_ENABLED=0` and no dynamic ELF interpreter. Install
a patch-compatible target runtime, or recapture with a manifest that names an
approved package set or bundled runtime layer.
