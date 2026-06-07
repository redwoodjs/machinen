# Clean service snapshot/restore

Clean-service snapshot/restore uses the normal product commands:

```sh
machinen snapshot <vm> <bundle>
machinen restore <bundle>
```

No `capture`, `--portable`, `--runtime`, `--language`, or proof-summary flag is part of the user workflow.

## Supported shape

A clean service is a process that Machinen can safely reconstruct on the target architecture. The current clean-service subsets are:

- `node-http-clean-root-v1`
- `python-http-clean-root-v1`
- `go-http-clean-root-v1` for statically linked HTTP services built without cgo

The service must have:

- a captured app root;
- reconstructable argv, cwd, and env;
- a known runtime version or static-binary policy;
- a declared listening HTTP endpoint;
- a target verifier that passes before restore reports success.

## Bundle files

A portable clean-service snapshot adds:

- `portable-clean-service.json`
- `clean-service-<runtime>-primary.tar.gz`
- `meta.json.portable`

## Restore behavior

When the target architecture differs from the source architecture, restore boots a target-native VM, materializes the app, starts the service, and runs the verifier.

A successful JSON result includes:

```json
{ "migrationCompleted": true, "targetVerifierResult": "passed" }
```

## Refusal rule

Machinen refuses state it cannot honestly recreate. Common refusal classes include:

- active TCP/TLS/websocket sessions;
- unexpected listeners;
- unmodeled Unix sockets, pipes, timers, eventfds, signalfds, epoll, or futex state;
- deleted-but-open files;
- writable host mounts;
- dirty mmap or database/WAL state;
- child-worker process trees;
- native addons, Python C extensions, cgo, or dynamically linked Go binaries.

Every refusal reports `migrationCompleted=false`.

Use `machinen support --json` for the current support and refusal registry.
