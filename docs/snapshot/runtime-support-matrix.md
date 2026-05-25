# Runtime support matrix

`runtime-support-matrix` is the Goal 10 conformance layer for runtime adapters.
It does not make Node, Python, Go, JVM, Ruby, or any app supported by prose. It
checks that each runtime manifest maps semantic state to already-graduated
app-neutral capabilities or to exact runtime refusal codes.

Run it with:

```sh
pnpm --silent runtime-support-matrix -- --json
```

The stable JSON artifact contains:

- `runtimeCounts` for planning-only vs supported runtime subsets;
- per-manifest `capabilityCoverage`, `gates`, refusal codes, refusal proofs, and
  target runtime/module provenance;
- `appHarnesses` showing whether application fixtures are verification-only;
- `timings` and `workdirs` for auditability.

A runtime manifest fails closed when it:

- requires an app-neutral capability that is not present in the proof profile
  support envelope;
- sets `supportClaimed=true` without positive proof profiles for every required
  capability;
- omits mandatory refusal codes for opaque native extension state, JIT/source
  executable code, app hooks, active sockets without contracts, worker/thread
  synchronization gaps, or opaque VM frames;
- records a wrong-arch, stale, missing, or mismatched target runtime/module/libc
  provenance failure that could complete migration.

The checked-in Node and Python manifests are planning-only. They record target
binary and module provenance and refuse native addons/C extensions, JIT/source
owned executable code, active sockets without Goal 8/9 contracts, workers or
threads without synchronization coverage, app hooks, and source-text replay. The
Go/JVM/Ruby manifests exercise the same adapter contract across different
scheduler, GC, JIT, FFI, and native-extension models.

Application harnesses are also verification-only. A harness can validate an
already-supported runtime subset, but it cannot use arbitrary pre/post migration
hooks, source-ISA execution, source text replay, or sidecar runtime success as a
correctness path.
