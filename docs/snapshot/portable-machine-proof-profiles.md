# Portable machine proof profiles

The native cross-ISA VM proof has a checked-in profile matrix in
[`scripts/portable-machine-proof-profiles.json`](../../scripts/portable-machine-proof-profiles.json).
Each row names the remote source target, source fixture, optional traced syscall
and fd, expected result, and target gates that must pass before automation may
report success.

Run the wrapper with:

```sh
pnpm portable-machine-proof-runner -- --profile file-readv --json
```

For test or CI wiring that should not contact remotes or boot the target VM:

```sh
pnpm portable-machine-proof-runner -- --profile file-readv --dry-run --json
```

Dry runs exercise profile selection, synthetic capture/bundle creation, and JSON
summary writing, but they intentionally report `pass: false` and `state:
"skipped"`. A run is successful only when the underlying smoke profile completes
and the gate checker passes.

## Gate checker

The runner refuses success unless the smoke summary and target restore result
show all required gates for the selected profile. The common success checks are:

- smoke summary `state="completed"`;
- matching `remoteSourceTarget`;
- target restore `state="completed"`;
- `migrationCompleted=true`;
- `descriptorGateCompleted=true`.

Profiles then add explicit target gates from the matrix, including verifier,
state consumption, fd/resource status, return-chain, frame, registers/RFLAGS,
TLS, stack-window, private-memory, executable mapping, signal restore,
active-syscall restore, process-context restore, controlled thread restore, and
resume-path checks.

Existing summaries can be checked without running the proof:

```sh
pnpm portable-machine-proof-runner -- \
  --profile file-writev \
  --check-summary /tmp/machinen-file-writev-e2e/summary.json \
  --json
```

This exits non-zero if any required gate is missing or not `passed`.

## Constrained native-transparent class

The current supported class is deliberately narrow: an arm64 Linux process
captured by the native-process bundle can restore into an amd64 VM only when its
state is covered by one of the proof profiles below and every listed target gate
passes. The accepted class includes:

- target-native continuation bytes from the portable bundle target root;
- metadata-proven return-chain/frame/register/RFLAGS/TLS/stack-window restore;
- target-owned private-memory, executable-mapping, signal, resource, and
  descriptor consumption gates;
- regular-file fd recipes, stdio/close-fd recipes, and the modeled synthetic
  empty pipe/eventfd/timerfd proof states;
- active syscall completion only for sleep/`ppoll` timeout, empty pipe read,
  empty eventfd read, timerfd read, offset-backed regular-file
  `read`/`pread64`/single-iovec `readv`, and offset-backed regular-file
  `write`/`pwrite64`/single-iovec `writev` cases;
- the controlled two-thread `ppoll` profile and the bounded process-context
  profile.

Everything outside that class must fail closed with a stable refusal before
`migrationCompleted=true`: sockets/epoll/signalfd/futex/rseq/general scheduler
state, source vDSO/vvar copying, source executable text reuse, JIT or
self-modifying code, pending signals/active signal frames, raw cross-ISA
`.vmstate` replay, missing provenance, malformed descriptors, or unsupported
resource kinds. The proof is not a Node/Bun sidecar, source-ISA emulation, app
hook, or source-text replay path; success means target-native completion after
all profile gates pass.

## Current profiles

| Profile            | Source fixture                     | Trace            | Profile-specific gates             |
| ------------------ | ---------------------------------- | ---------------- | ---------------------------------- |
| `two-thread-ppoll` | `native-two-thread-ppoll-target.c` | none             | active syscall + controlled thread |
| `pipe-read`        | `native-pipe-read-target.c`        | none             | active syscall                     |
| `eventfd-read`     | `native-eventfd-read-target.c`     | none             | active syscall                     |
| `timerfd-read`     | `native-timerfd-read-target.c`     | none             | active syscall                     |
| `file-read`        | `native-file-read-target.c`        | `read` fd 38     | active syscall                     |
| `file-pread`       | `native-file-pread-target.c`       | `pread64` fd 40  | active syscall                     |
| `file-readv`       | `native-file-readv-target.c`       | `readv` fd 42    | active syscall                     |
| `file-write`       | `native-file-write-target.c`       | `write` fd 39    | active syscall                     |
| `file-pwrite`      | `native-file-pwrite-target.c`      | `pwrite64` fd 41 | active syscall                     |
| `file-writev`      | `native-file-writev-target.c`      | `writev` fd 43   | active syscall                     |
| `process-context`  | `native-ppoll-timeout-target.c`    | none             | process context                    |

All profiles also require descriptor, verifier, state-consumption, resource,
return-chain, frame, register/RFLAGS, TLS, stack-window, private-memory,
executable, signal, and resume-path gates. The matrix is the automation contract
for the current constrained class: adding a new accepted family requires a new
profile (or an explicit documented refusal if it stays unsupported), target gate
coverage, fail-closed tests, and docs updates before it can be counted as
native-transparent success.
