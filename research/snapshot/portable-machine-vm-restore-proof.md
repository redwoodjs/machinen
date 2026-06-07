# Portable machine VM restore proof

Issue #589 wires the ladder pieces into one product-shaped proof profile:

```text
arm64 source context -> portable machine snapshot bundle -> amd64 target VM -> target-native completion
```

The proof harness requires a validated portable machine snapshot bundle and target
continuation bytes stored inside that bundle. It can now combine target
continuation metadata, target guest memory materialization entries, and the
translated fd-table recipes into one target-guest restore descriptor before VM
execution. Unsafe memory, fd, or thread state refuses before descriptor
execution. The harness then boots the amd64 target VM through the target-guest
loader path. A
run is successful only when the target VM reports target-native completion with:

- `migrationCompleted: true`
- `descriptorGateCompleted: true`
- `sourceTextReusedAsTargetCode: false`
- `sourceIsaEmulationUsed: false`
- `sidecarRuntimeUsed: false`
- every present native restore consumption marker is `passed`, including stack
  window writes, private memory restore, executable mapping materialization,
  signal-mask handoff, active syscall re-arm, and controlled thread-spawn
  consumption

Example:

```bash
MACHINEN_TARGET_VM_IMAGE=/path/to/rootfs-amd64.tar.gz \
  pnpm portable-machine-vm-restore-proof -- \
  --bundle-dir /tmp/portable-machine \
  --target-code-file /tmp/portable-machine/target/continuation.bin \
  --combined-descriptor \
  --real-utility-continuation \
  --json
```

The harness skips clearly when no amd64 VM image is available. CI should run this
profile whenever portable machine bundle layout, target guest loader behavior,
restore descriptor handling, or target-native continuation execution changes.
Raw cross-ISA `.vmstate` replay remains a refusal, not a success path.

## Native restore consumption boundary

The combined descriptor can carry both legacy descriptor entries and explicit
`native=` sections. The current target trampoline consumes these sections as
actual target-side work before reporting completion:

| Section                                     | Target-side status                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `stack-window-write` / `stack-window-guard` | writes target stack slots and maps guard pages                                                             |
| `return-chain-write`                        | writes bounded target return-chain slots                                                                   |
| `private-memory`                            | performs target `mmap`, byte copy, guard mapping, and final `mprotect`; also backs target TLS/TCB restore  |
| `executable-mapping`                        | checks target code path/address/size/file-offset, execute/private flags, and build-id or sha256 provenance |
| `signal-restore`                            | saves, applies, verifies, and restores the loader signal mask                                              |
| `active-syscall`                            | validates modeled sleep/ppoll timeout steps and arms target-side timerfds                                  |
| `thread-spawn`                              | maps requested stacks and consumes controlled spawn steps with short-lived target tasks                    |

Absent sections remain backward-compatible. Present sections fail closed if their
consumption marker is missing or not `passed`; the smoke profile additionally
requires stack-window, private-memory, executable-mapping, and signal restore
markers for the combined proof. General multithread, futex/rseq, arbitrary active
syscall restart, and broad target libc/vDSO state remain outside this proof and
must refuse precisely.

`planPortableMachineTargetRestoreDescriptor()` is the combined descriptor gate:
fd-table refusals, executable-source memory, ambiguous mappings, and other unsafe
materialization blockers are returned as refusals instead of entering the guest.
Ready descriptors include only approved target-native continuation bytes,
explicit fd-table recipes, and safe non-executable memory entries. The current
combined proof can still use generated verifier bytes, but the smoke path now
uses `--real-utility-continuation`: target module bytes are materialized from a
portable-bundle target root, entered through the amd64 guest loader, and accepted
only when the in-guest resume event returns the expected value. The real utility
now consumes restored state before returning: it checks the materialized captured
memory byte, validates the descriptor-provided register handoff without
reserving `%rdi` for the proof ABI, and exercises the wider fd matrix: closed fd,
inherited stdout, reopened file,
synthetic pipe, eventfd, and timerfd recipes. The descriptor also seeds a
translated target return address and a small translated caller frame. The
trampoline materializes that target stack frame, seeds modeled `rbp`/`r12`, and
the target-native continuation validates the frame before returning through the
target-native landing. The restore boundary accepts only one safe stopped thread
for this proof; multi-thread, futex, signal-delivery, ptrace/debug,
shared-stack, unknown/ambiguous TLS or target segment-base, ambiguous register,
and live/unknown SIMD/FPU states refuse before the target VM is entered. The
current continuation materializes a minimal target-owned amd64 TCB page, sets
`%fs` to that page before the target-native jump, reads proof markers through
`%fs`, and restores the host `%fs` on return. The descriptor uses `resumeMode=translated-frame`, so the success
path records a target-native resume-path marker after the real continuation
observes the translated frame, stack-slot vector, amd64 callee-saved register
bank, modeled resume-register handoff including `%rdi`, and modeled RFLAGS
condition-code handoff.

## Smoke profile

Issue #593 adds a named smoke wrapper. The local mode synthesizes the source
bundle and runs the target proof on the current host:

```bash
PORTABLE_MACHINE_TARGET_VM_IMAGE=/path/to/rootfs-amd64.tar.gz \
  pnpm --silent run proof-portable-machine-restore -- --json
```

Issue #594 adds an opt-in remote e2e mode:

```bash
PORTABLE_AMD64_REPO=/path/to/machinen/on/amd64 \
PORTABLE_MACHINE_TARGET_VM_IMAGE=/path/to/rootfs-amd64.tar.gz \
  pnpm --silent run proof-portable-machine-restore -- --remote-e2e --json --keep
```

Remote e2e mode captures the native-process bundle on `PORTABLE_ARM64_SSH`
(default `friend@100.126.46.90`), copies the portable bundle to
`PORTABLE_AMD64_SSH` (default `root@192.168.0.8`), and invokes
`pnpm portable-machine-vm-restore-proof` from `PORTABLE_AMD64_REPO` against the
remote target image path. Dry-run mode never contacts remotes, so it can validate
summary shape on any host.

For repeated profile automation, use the checked-in matrix and wrapper described
in [Portable machine proof profiles](./portable-machine-proof-profiles.md):

```bash
pnpm portable-machine-proof-runner -- --profile file-readv --json
```

The wrapper runs the same smoke profile, records wrapper and smoke timings, keeps
log paths in one JSON summary, and refuses to report `pass: true` unless every
required target gate for the selected profile passed.

The smoke profile creates or captures a narrow arm64 native-process bundle,
wraps it in a portable machine snapshot, stages a target-native amd64 real
utility continuation inside the bundle, and runs the portable machine VM restore
proof with a combined restore descriptor. Remote e2e mode captures a real arm64
two-thread process with one thread blocked in a modeled `ppoll` timeout. It
requires the emitted `native=active-syscall` and `native=thread-spawn` sections
to report `targetActiveSyscallRestoreResult=passed` and
`targetThreadRestoreResult=passed`. The continuation is target module bytes
from the bundle's approved target root, not source-ISA text. The JSON summary
includes `targetRestore.state`, `targetRestore.migrationCompleted`,
`targetRestore.descriptorGateCompleted`, descriptor memory/fd counts,
resource recipe kinds, `targetRestore.targetContinuationKind`,
`targetRestore.targetContinuationReturnValue`,
`targetRestore.targetStateConsumptionResult`, per-resource status,
`targetRestore.targetStackWindowMaterializationResult`,
`targetRestore.targetPrivateMemoryRestoreResult`,
`targetRestore.targetExecutableMappingResult`,
`targetRestore.targetSignalRestoreResult`,
`targetRestore.targetActiveSyscallRestoreResult`,
`targetRestore.targetReturnChainResult`,
`targetRestore.targetTranslatedReturnAddress`,
`targetRestore.targetFrameRestoreResult`,
`targetRestore.targetTranslatedFramePointer`,
`targetRestore.targetThreadRestoreResult`,
`targetRestore.targetThreadRestoreThreadId`,
`targetRestore.targetResumePathResult`,
`targetRestore.targetResumePathMode`,
`targetRestore.targetRegisterRestoreResult`,
`targetRestore.targetRflagsRestoreResult`,
`targetRestore.targetTlsRestoreResult`, and
`targetRestore.targetVerifierResult`. It reports timing for:

1. preflight / optional remote reachability gates;
2. arm64 source capture bundle creation;
3. portable bundle validation and target-byte staging;
4. bundle transfer (local no-op or remote copy to the amd64 host);
5. target VM boot/restore and completion.

Set `PORTABLE_MACHINE_SMOKE_REQUIRE_REMOTES=1` to require the default remote
reachability checks even outside `--remote-e2e`. Missing remotes, a missing
`PORTABLE_AMD64_REPO`, a missing `PORTABLE_MACHINE_TARGET_VM_IMAGE` /
`MACHINEN_TARGET_VM_IMAGE`, or a non-Linux amd64 target host produce a clear skip
with timing data. Failures preserve the work directory, local/remote bundle
paths, target logs, and generated summary; use `--keep` to keep artifacts after
successful or skipped runs as well.

Run this named smoke when touching portable machine bundle layout, target-guest
loader descriptors, target VM restore wiring, target continuation execution, or
other VM-level portable cross-ISA restore behavior. The memory materialization
planner refuses executable source mappings, shared mappings, ambiguous captured
byte provenance, and partial captured ranges with precise refusal codes before
entering the guest. Full `pnpm smoke-tests` remains the broader VM lifecycle
suite.

Latest default remote arm64→amd64 proof after native target-loader consumption hardening:

- `state=completed`
- `descriptorGateCompleted=true`
- `targetContinuationKind=real-utility`
- `targetContinuationStatus=returned`
- `targetContinuationReturnValue=0x4d`
- `targetStateConsumptionResult=passed`
- `targetReturnChainResult=passed`
- `targetFrameRestoreResult=passed`
- `targetRegisterRestoreResult=passed`
- `targetRflagsRestoreResult=passed`
- `targetTlsRestoreResult=passed`
- `targetStackWindowMaterializationResult=passed`
- `targetPrivateMemoryRestoreResult=passed`
- `targetExecutableMappingResult=passed`
- `targetSignalRestoreResult=passed`
- `targetActiveSyscallRestoreResult=passed`
- `targetThreadRestoreResult=passed`
- wall time: 1m19.244s
- target VM boot/restore: 62.342s

The same smoke script can set `PORTABLE_MACHINE_REMOTE_SOURCE_TARGET=pipe-read`
`eventfd-read`, or `timerfd-read` to capture a single-thread arm64 process
blocked in `read` on an empty pipe, eventfd, or timerfd. These fd-read profiles require
`targetActiveSyscallRestoreResult=passed` and keep the existing native
target-loader gates enabled, but do not require the controlled two-thread marker
because no thread-spawn section is present.
