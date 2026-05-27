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

Node snapshots may also include the older `portable-node.json` files for backward
compatibility, but new product restore uses the shared clean-service manifest.

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
refusals include active TCP/TLS sessions, child process trees, missing verifiers,
digest tamper, target architecture mismatch, runtime policy mismatch,
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
reconnect after restore. Quiesce databases, checkpoint WAL, or use a logical
service-specific capture such as the PostgreSQL product path. Stop child workers
or run one accepted service component until process groups are supported. Avoid
writable host-mounted app roots. Rebuild native extensions for the target with
explicit provenance, or rebuild Go services with `CGO_ENABLED=0`. Install a
patch-compatible target runtime, or recapture with a manifest that names an
approved package set or bundled runtime layer.
