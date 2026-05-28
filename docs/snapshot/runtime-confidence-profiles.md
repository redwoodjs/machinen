# C and Java runtime confidence profiles

Runtime confidence profiles classify non-toy C and Java/JVM restore shapes before
we call them product support. The classifications are:

- `product-supported` — product capture/restore is implemented and verified.
- `proof-only-feasibility` — useful proof evidence exists, but it is not product
  support.
- `stretch-demo` — exploratory only.
- `refused` — fail closed with a stable reason and remediation.

## Row shape

```json
{
  "kind": "machinen.architecture-portable-snapshot.runtime-confidence-profile",
  "runtime": "c",
  "profile": "c-static-binary",
  "classification": "proof-only-feasibility",
  "sourceArch": "arm64",
  "targetArch": "amd64",
  "stateModel": "recreated",
  "migrationCompleted": false
}
```

`migrationCompleted` stays `false` unless a product-supported runtime path exists.
This keeps proof fixtures from becoming accidental product claims.

## C profiles

| Profile            | Classification           | State model          | Reason                                                                                  |
| ------------------ | ------------------------ | -------------------- | --------------------------------------------------------------------------------------- |
| `c-static-binary`  | `proof-only-feasibility` | `recreated`          | Static target-native rebuild plus verifier is plausible, but no product surface exists. |
| `c-dynamic-binary` | `refused`                | `refused`            | Dynamic loader, libc, and shared-object provenance are required before support.         |
| `c-file-io`        | `proof-only-feasibility` | `logically-restored` | Regular file contents/cursor can be modeled by digest, but this is not product support. |
| `c-timer`          | `refused`                | `refused`            | Active timer deadline and signal order are not modeled.                                 |
| `c-signal`         | `refused`                | `refused`            | Signal masks, pending signals, and signal-frame edge state are not modeled.             |
| `c-tcp-listener`   | `refused`                | `refused`            | Active sockets/listener identity are not portable resources here.                       |

Dynamic C remediation: record the target dynamic loader, libc, all shared-object
digests, ABI policy, and a target-native verifier before accepting the profile.

## Java/JVM profile

`java-loop-service` is refused in both `arm64 -> amd64` and `amd64 -> arm64`
routes. The matrix records:

- runtime version: `JVM unavailable in base guest; vendor/version not recorded`;
- classpath provenance: fixture source only;
- loaded native libraries: not inspected because the target JVM is unavailable;
- verifier output: `command -v java produced no target runtime path;
JVM-private/JIT/thread state not modeled`.

JVM remediation: install a controlled target JVM, record vendor/version,
classpath/module graph, loaded native libraries, and explicitly model JIT/code
cache, runtime-private state, process topology, active sockets, signal state, and
threads before accepting restore.

## What this proves

The matrix proves that every required C and Java profile has a machine-readable
classification in both architecture directions. It proves the refusal boundary
for dynamic C provenance, timers/signals, active sockets, and missing JVM/JIT
state is stable.

## What this does not prove

It does not prove product support for C or Java runtime restore. It does not run a
real JVM loop in the base guest. It does not restore dynamic C libraries,
timers/signals, active sockets, JVM private state, JIT code cache, Java threads,
or JNI/native library state across architectures.

## Running

```sh
pnpm run smoke-runtime-confidence-profile-matrix
```
